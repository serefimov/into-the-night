// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
import {MissionSession,CAMPAIGN_MODEL} from '../dist/core/mission.js';
import {forecastMissionFlight} from '../dist/core/mission-flight.js';
import {forecastChapterOne} from '../dist/core/mission-ground.js';
import {canonicalJson} from '../dist/core/serialization.js';
import {certifyPolarDay} from './campaign-research.mjs';
import {westwardRouteEvidence} from './westward-research.mjs';
export const CHAPTER_ONE_SETTINGS=Object.freeze({definition:'data/scenarios/chapter-one-v1.json',path:['BIKF','CYEG','UHMA','UNNT'],onward:'UACC',budgetsHours:[3,4,5],selectedHours:4,
 solar:{eventToleranceSeconds:.05,maxIntervalSeconds:300,maxEvaluations:100000},
 startGrid:{dates:['2026-08-01','2026-08-10','2026-08-15','2026-08-20'],utcMinutes:[1140,1155,1170,1185,1200],fuelKg:[30000,65000]},
 scope:'Finite routes/start/fuel grid, not global impossibility. No plane/solar changes, fuel unloading, stock resets, protection or road shortening.'});
const hash=v=>createHash('sha256').update(canonicalJson(v)).digest('hex');
const initial=d=>({...structuredClone(d.initial),flights:0,distanceKm:0,won:false});
const compactGround=({phases,...forecast})=>({...forecast,phases:['ground_outbound','ground_acquisition','ground_return'].map(label=>{const rows=phases.filter(p=>p.label===label);return {label,startUtcMs:rows[0].route.startUtcMs,endUtcMs:rows.at(-1).route.endUtcMs,segments:rows.length};})});
const stocks=(d,s)=>Object.fromEntries(Object.entries(s.stocks).filter(([id,kg])=>kg!==d.initial.stocks[id]));
const snapshot=(d,s)=>{const {stocks:all,...rest}=s;return {...rest,stockChangesKg:stocks(d,s)};};
function replay(d,path,options){let state=initial(d),legs=[];for(const to of path){const f=forecastMissionFlight(d,state,to,options);legs.push({from:state.airportId,to,allowed:f.allowed,reasons:f.reasons,startUtcMs:state.utcMs,departureUtcMs:f.departureUtcMs,arrivalUtcMs:f.arrivalUtcMs,endUtcMs:f.endUtcMs,distanceKm:f.distanceKm,flight:f.flight,refuelling:f.refuelling,solar:f.solar});if(!f.allowed)return {state:null,legs};state=f.next;}return {state,legs};}
function onwardIds(d,state,options){const allowed=[];for(const a of d.airports){if(a.id===state.airportId)continue;const f=forecastMissionFlight(d,state,a.id,options);if(f.allowed)allowed.push(a.id);}return allowed;}
function budget(d,state,hours,scan=true){const seconds=(hours*3600-3600)/2,ground=forecastChapterOne({...d.chapterOne,outboundSeconds:seconds,returnSeconds:seconds},state.utcMs,CHAPTER_ONE_SETTINGS.solar);
 return {hours,ground:compactGround(ground),onwardSafeIds:ground.allowed&&scan?onwardIds(d,{...state,utcMs:ground.endUtcMs,won:false},CHAPTER_ONE_SETTINGS.solar):[]};}
export async function researchChapterOne(){
 const settings=CHAPTER_ONE_SETTINGS,d=await loadCycleDefinition(settings.definition),old=await loadCycleDefinition();
 const historical={...old,chapterOne:d.chapterOne},oldReplay=replay(historical,settings.path,settings.solar),primary=replay(d,settings.path,settings.solar);
 if(!oldReplay.state||!primary.state)throw Error('Missing airport witness');
 const historicalBudgets=settings.budgetsHours.map(h=>budget(historical,oldReplay.state,h)),budgets=settings.budgetsHours.map(h=>budget(d,primary.state,h));
 // Compare the old published alternative routes before changing starting conditions.
 const oldRoutes=JSON.parse(await readFile('docs/academic-westward/routes.json','utf8')),oldAlternatives=oldRoutes.map(r=>{
  const x=replay(historical,r.path,settings.solar);if(!x.state)throw Error('Historical route changed');
  const f=forecastChapterOne(d.chapterOne,x.state.utcMs,settings.solar);return {path:r.path,readyUtcMs:x.state.utcMs,expeditionAllowed:f.allowed,reason:f.reasons,returnMarginSeconds:f.returnMarginSeconds};
 });
 const startGrid=[];
 for(const date of settings.startGrid.dates)for(const minute of settings.startGrid.utcMinutes)for(const fuelKg of settings.startGrid.fuelKg){
  const candidate={...d,initial:{...d.initial,utcMs:Date.parse(date+'T00:00:00Z')+minute*60000,fuelKg}},r=replay(candidate,settings.path,settings.solar);
  const direct=forecastMissionFlight(candidate,initial(candidate),'UNNT',settings.solar);
  const g=r.state?forecastChapterOne(d.chapterOne,r.state.utcMs,settings.solar):null;
  const onwards=g?.allowed?onwardIds(candidate,{...r.state,utcMs:g.endUtcMs},settings.solar):[];
  startGrid.push({date,minute,fuelKg,directSolar:direct.solar.status,airportReadyUtcMs:r.state?.utcMs??null,flightBlock:r.state?null:r.legs.at(-1).reasons,expeditionAllowed:g?.allowed??false,onwardSafeCount:onwards.length});
 }
 const direct=forecastMissionFlight(d,initial(d),'UNNT',settings.solar),evidence=westwardRouteEvidence(d.airports,[d.initial.airportId,...settings.path]);
 if(direct.solar.status!=='unsafe'||!evidence.westwardAroundWorld)throw Error('Scenario must require a western circuit');
 const session=new MissionSession(d),ordinary=new MissionSession(d,settings.solar);
 for(const to of settings.path){if(!session.fly(to).allowed||!ordinary.fly(to).allowed)throw Error('Shared session blocked flight');session.resume();ordinary.resume();}
 if(session.current().state.status!=='running'||session.current().state.campaign.knowledgeIds.length)throw Error('Airport landing awarded knowledge or victory');
 const airportState=snapshot(d,session.current().state),forecast=session.forecastExpedition();
 if(!forecast.allowed||!session.startExpedition().allowed||!ordinary.startExpedition().allowed)throw Error('Expedition is unsafe');
 session.resume();ordinary.resume();
 const returned=snapshot(d,session.current().state);
 if(canonicalJson(session.current())!==canonicalJson(ordinary.current())||returned.campaign.knowledgeIds.length!==1||!returned.campaign.chapterOneCompleted)throw Error('Forecast/replay mismatch');
 const continuation=session.forecast(settings.onward);if(!continuation.allowed)throw Error('No inherited safe continuation');
 session.fly(settings.onward);session.resume();
 const polarDays=[];for(let day=Math.floor(d.initial.utcMs/86400000)*86400000;day<=session.currentTimeUtc;day+=86400000){const polar=certifyPolarDay(d.airports.find(a=>a.id==='ENSB'),day,settings.solar);if(polar.status!=='safe')throw Error('Svalbard polar day absent');polarDays.push({utcMs:day,solar:polar});}
 return {reportVersion:1,model:CAMPAIGN_MODEL,settings,scenarioId:d.scenarioId,scenarioVersion:d.scenarioVersion,inputsSha256:{definition:hash(d),profile:hash(d.profile),outbound:hash(JSON.parse(await readFile('data/campaign/chapter-one/outbound.json','utf8'))),inbound:hash(JSON.parse(await readFile('data/campaign/chapter-one/return.json','utf8')))},
  historical:{airportReadyUtcMs:oldReplay.state.utcMs,budgets:historicalBudgets,alternatives:oldAlternatives},startGrid,
  direct:{allowed:direct.allowed,solar:direct.solar},polarDays,evidence,budgets,
  witness:{initial:snapshot(d,new MissionSession(d).current().state),path:settings.path,legs:primary.legs,airportState,expedition:compactGround(forecast.forecast),returned,
   onward:{to:settings.onward,departureUtcMs:continuation.forecast.departureUtcMs,arrivalUtcMs:continuation.forecast.arrivalUtcMs,endUtcMs:continuation.forecast.endUtcMs,solar:continuation.forecast.solar,refuelling:continuation.forecast.refuelling},final:snapshot(d,session.current().state),events:session.current().events},
  scope:'Chapter one and one inherited safe onward flight only; not a Japan chain, food model, completed campaign, real road-time guarantee or operational aircraft clearance.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2);if(args.some(a=>!['--write','--verify'].includes(a))||args.length>1)throw Error('Use [--write|--verify]');const result=await researchChapterOne(),path='docs/chapter-one/report.json';
  if(args.includes('--write')){await mkdir('docs/chapter-one',{recursive:true});await writeFile(path,JSON.stringify(result,null,2)+'\n');}
  if(args.includes('--verify')&&canonicalJson(result)!==canonicalJson(JSON.parse(await readFile(path,'utf8'))))throw Error('Chapter one report differs');
  console.log(JSON.stringify({passed:true,verified:args.includes('--verify'),scenarioId:result.scenarioId,returnedUtc:new Date(result.witness.returned.utcMs).toISOString(),onward:result.witness.onward.to,budgets:result.budgets.map(b=>({hours:b.hours,safe:b.ground.allowed,onward:b.onwardSafeIds.length})),scope:result.scope},null,2));
 }catch(error){console.error(error.stack);process.exitCode=1;}
}
