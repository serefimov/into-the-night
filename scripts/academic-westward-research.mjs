// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
import {forecastMissionFlight} from '../dist/core/mission-flight.js';
import {MissionSession,MISSION_MODEL} from '../dist/core/mission.js';
import {canonicalJson} from '../dist/core/serialization.js';
import {solarExposure} from '../dist/core/solar.js';
import {searchStationarySunrise} from '../dist/core/waiting.js';
import {certifyPolarDay} from './campaign-research.mjs';
import {westwardRouteEvidence} from './westward-research.mjs';
export const ACADEMIC_SETTINGS=Object.freeze({definition:'data/scenarios/academic-westward-v2.json',
 dates:['2026-07-13','2026-07-20','2026-07-25','2026-08-01'],utcHour:20,
 first:['BIKF','EGPH','EGPF','EGAA','EIDW','EGCC','EGLL','ENGM','ESSA','EFHK','ENVA','EKCH','EDDH','BGSF','EGPD'],
 canada:['CYEG','CYYC','CYWG','CYVR','PANC','CYXE','CYQX'],asia:['UHPP','UHMA','UHHH','UHWW','UHSS','RJCC'],
 primary:['BIKF','CYEG','UHMA','UNNT'],
 refined:{eventToleranceSeconds:.05,maxIntervalSeconds:300,maxEvaluations:100000},
 scope:'Finite candidate-chain/date grid, not an exhaustive search or a ban on other airports, directions, dates or longer paths. No waits, fuel unloading, manual fuel choices or new airports.'});
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const directory='docs/academic-westward';
const parts=['report','routes','witness','continuation'];
export async function loadAcademicReport(){return Object.fromEntries(await Promise.all(parts.map(async name=>[name,JSON.parse(await readFile(`${directory}/${name}.json`,'utf8'))])));}
function initialState(d,utcMs=d.initial.utcMs){return {...structuredClone(d.initial),utcMs,flights:0,distanceKm:0,won:false};}
function changedStocks(d,state){return Object.fromEntries(Object.entries(state.stocks).filter(([id,kg])=>kg!==d.initial.stocks[id]));}
function legRecord(from,to,f){return {from,to,startUtcMs:f.phases[0].route.startUtcMs,departureUtcMs:f.departureUtcMs,arrivalUtcMs:f.arrivalUtcMs,endUtcMs:f.endUtcMs,distanceKm:f.distanceKm,
 flight:f.flight,refuelling:f.refuelling,solar:f.solar,phases:f.phases.map(p=>({label:p.label,kind:p.route.kind,startUtcMs:p.route.startUtcMs,endUtcMs:p.route.endUtcMs}))};}
function enumerate(d,utcMs){
 const s=ACADEMIC_SETTINGS,initial=initialState(d,utcMs),eligible=new Set(d.airports.filter(a=>a.suitability.status==='screened-candidate').map(a=>a.id)),cache=new Map(),routes=[],counts={forecasts:0,resourceRejected:0,solarRejected:0,indeterminate:0};
 const root={path:[],state:initial,legs:[]};
 function next(node,id){const key=[...node.path,id].join('/');if(cache.has(key))return cache.get(key);counts.forecasts++;
  const f=forecastMissionFlight(d,node.state,id,s.refined);let value=null;
  if(f.allowed)value={path:[...node.path,id],state:f.next,legs:[...node.legs,legRecord(node.state.airportId,id,f)]};
  else if(f.solarScope==='invalid_resources')counts.resourceRejected++;else if(f.solar.status==='unsafe')counts.solarRejected++;else counts.indeterminate++;
  cache.set(key,value);return value;
 }
 for(const a of s.first.filter(id=>eligible.has(id))){const first=next(root,a);if(!first)continue;
  for(const b of s.canada.filter(id=>eligible.has(id))){const second=next(first,b);if(!second)continue;
   for(const c of s.asia.filter(id=>eligible.has(id))){const third=next(second,c);if(!third)continue;const last=next(third,d.targetId);if(last)routes.push(last);}
  }
 }
 return {initial,routes,counts};
}
function shortRouteAudit(d){const initial=initialState(d),first=[],safePaths=[],unresolved=[];let examined=0;
 for(const airport of d.airports){if([initial.airportId,d.targetId].includes(airport.id))continue;examined++;
  const f=forecastMissionFlight(d,initial,airport.id,ACADEMIC_SETTINGS.refined);
  if(f.allowed)first.push(airport.id);else if(f.reasons.every(r=>r==='solar_indeterminate'))unresolved.push([airport.id]);
  if(!f.allowed)continue;const second=forecastMissionFlight(d,f.next,d.targetId,ACADEMIC_SETTINGS.refined);
  if(second.allowed)safePaths.push([airport.id,d.targetId]);else if(second.reasons.every(r=>r==='solar_indeterminate'))unresolved.push([airport.id,d.targetId]);
 }
 return {maxFlights:2,examinedFirstDestinations:examined,safeFirstCount:first.length,safeFirstIds:first,safePaths,unresolved,
  scope:'All catalog airports as the sole intermediate, fixed initial state and automatic dispatch rule. Does not rule out other configurations or paths with more flights.'};
}
function continuation(d,state){const world={...d,targetId:'RJTT'},inherited={...state,won:false},allowedIds=[],unresolvedIds=[];
 for(const airport of d.airports){if(airport.id===state.airportId)continue;const f=forecastMissionFlight(world,inherited,airport.id,ACADEMIC_SETTINGS.refined);if(f.allowed)allowedIds.push(airport.id);else if(f.reasons.every(r=>r==='solar_indeterminate'))unresolvedIds.push(airport.id);}
 const direct=forecastMissionFlight(world,inherited,'RJTT',ACADEMIC_SETTINGS.refined);
 return {allowedIds,unresolvedIds,directJapan:{allowed:direct.allowed,reasons:direct.reasons,solar:direct.solar}};
}
export async function researchAcademic(){
 const d=await loadCycleDefinition(ACADEMIC_SETTINGS.definition),initial=initialState(d),before=canonicalJson(initial),selected=enumerate(d,initial.utcMs),primary=selected.routes.find(r=>canonicalJson(r.path)===canonicalJson(ACADEMIC_SETTINGS.primary));
 if(!primary||!solarExposure(d.airports.find(a=>a.id===d.initial.airportId),initial.utcMs).safe)throw Error('Missing safe primary route');
 const direct=forecastMissionFlight(d,initial,d.targetId,ACADEMIC_SETTINGS.refined),shortcuts=shortRouteAudit(d);
 if(direct.solar.status!=='unsafe'||shortcuts.safePaths.length||shortcuts.unresolved.length)throw Error('Scenario shortcut audit failed or unresolved');
 const session=new MissionSession(d),ordinary=[];
 for(const to of primary.path){const f=session.forecast(to);if(!f.allowed)throw Error('Ordinary session blocks primary');session.fly(to);session.resume();ordinary.push(f.forecast.solar.status);}
 const final=session.current().state;
 if(final.utcMs!==primary.state.utcMs||final.fuelKg!==primary.state.fuelKg||canonicalJson(final.stocks)!==canonicalJson(primary.state.stocks)||final.status!=='won'||before!==canonicalJson(initial))throw Error('Session replay differs');
 const routes=[];let latest=initial.utcMs;
 for(const r of selected.routes){const evidence=westwardRouteEvidence(d.airports,[initial.airportId,...r.path]);if(!evidence.westwardAroundWorld)throw Error('Selected chain is not a western circuit');
  let state=initial;for(const to of r.path){const f=forecastMissionFlight(d,state,to);if(!f.allowed)throw Error('Ordinary forecast blocks alternative');state=f.next;}
  if(state.utcMs!==r.state.utcMs||state.fuelKg!==r.state.fuelKg)throw Error('Refined replay differs');
  latest=Math.max(latest,r.state.utcMs);const onward=continuation(d,r.state);
  routes.push({path:r.path,evidence,final:{utcMs:r.state.utcMs,fuelKg:r.state.fuelKg,distanceKm:r.state.distanceKm,flights:r.state.flights},stockChangesKg:changedStocks(d,r.state),refined:'safe',ordinary:'safe',onwardSafeCount:onward.allowedIds.length,onwardUnresolvedCount:onward.unresolvedIds.length});
 }
 const polarDays=[];for(let utc=Math.floor(initial.utcMs/86400000)*86400000;utc<=latest;utc+=86400000){const svalbard=certifyPolarDay(d.airports.find(a=>a.id==='ENSB'),utc),northPole=certifyPolarDay({latitudeDeg:90,longitudeDeg:0},utc);if(svalbard.status!=='safe'||northPole.status!=='safe')throw Error('Northern polar day absent');polarDays.push({date:new Date(utc).toISOString().slice(0,10),svalbard,northPole});}
 const dateGrid=ACADEMIC_SETTINGS.dates.map(date=>{const r=date===new Date(initial.utcMs).toISOString().slice(0,10)?selected:enumerate(d,Date.parse(date+'T20:00:00Z'));return {date,utcHour:20,fullChains:r.routes.length,firstIds:[...new Set(r.routes.map(p=>p.path[0]))],counts:r.counts};});
 const onward=continuation(d,primary.state);if(!onward.allowedIds.length)throw Error('Primary airport arrival is a dead end');
 return {report:{reportVersion:1,model:MISSION_MODEL,scenarioId:d.scenarioId,scenarioVersion:d.scenarioVersion,seed:d.seed,stockVersion:d.stockVersion,worldVersion:d.worldVersion,
  profileId:d.profile.id,profileVersion:d.profile.profileVersion,inputsSha256:{definition:hash(d),profile:hash(d.profile),airports:hash(d.airports),stocks:hash(d.initial.stocks)},settings:ACADEMIC_SETTINGS,
  initial:{airportId:initial.airportId,utcMs:initial.utcMs,fuelKg:initial.fuelKg,stockKgPerAirport:64000},targetId:d.targetId,targetCompletion:d.targetCompletion,
  direct:{allowed:direct.allowed,reasons:direct.reasons,solar:direct.solar},shortcuts,polarDays,dateGrid,fullChainCount:routes.length,firstIds:[...new Set(routes.map(p=>p.path[0]))],
  scope:'Airport-stage witness only. Knowledge transfer, trip to Akademgorodok, a complete Japan route, food, waiting and the full campaign are not certified. Historical reports are unchanged.'},
 routes,witness:{initial:{airportId:initial.airportId,utcMs:initial.utcMs,fuelKg:initial.fuelKg},path:primary.path,legs:primary.legs,ordinary,
  final:{airportId:primary.state.airportId,utcMs:primary.state.utcMs,fuelKg:primary.state.fuelKg,distanceKm:primary.state.distanceKm,flights:primary.state.flights,stockChangesKg:changedStocks(d,primary.state)},events:session.current().events},
 continuation:{fromId:primary.state.airportId,utcMs:primary.state.utcMs,fuelKg:primary.state.fuelKg,stockChangesKg:changedStocks(d,primary.state),targetId:'RJTT',...onward,
  sunrise:searchStationarySunrise(d.airports.find(a=>a.id===primary.state.airportId),primary.state.utcMs,ACADEMIC_SETTINGS.refined),knowledgeTransferSeconds:null,
  scope:'Immediate onward flights from actual inherited state without additional laboratory time. Does not certify a Japan chain or knowledge collection.'}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.some(a=>!['--write','--verify'].includes(a))||args.includes('--write')&&args.includes('--verify'))throw Error('Invalid academic research arguments');const result=await researchAcademic();
  if(args.includes('--write')){await mkdir(directory,{recursive:true});for(const name of parts)await writeFile(`${directory}/${name}.json`,JSON.stringify(result[name],null,2)+'\n');}
  if(args.includes('--verify')&&canonicalJson(result)!==canonicalJson(await loadAcademicReport()))throw Error('Academic report differs');
  console.log(JSON.stringify({scenarioId:result.report.scenarioId,initial:result.report.initial,chains:result.report.fullChainCount,firstIds:result.report.firstIds,primary:result.witness.path,final:result.witness.final,onward:result.continuation.allowedIds,verified:args.includes('--verify')},null,2));
 }catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
