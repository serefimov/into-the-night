// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadCampaignData} from './campaign-data.mjs';
import {loadCampaignReport,CAMPAIGN_SETTINGS,certifyPolarDay,campaignState} from './campaign-research.mjs';
import {forecastResearchFlight,executeResearchFlight,firstFlightFuelEnvelope} from '../dist/core/mission-research.js';
import {aircraftLeg} from '../dist/core/aircraft.js';
import {greatCircle} from '../dist/core/geometry.js';
import {solarExposure} from '../dist/core/solar.js';
import {searchSolarInterval} from '../dist/core/interval-search.js';
import {ROUTE_MODEL} from '../dist/core/route.js';
import {canonicalJson} from '../dist/core/saves.js';
export const WESTWARD_SETTINGS=Object.freeze({version:'westward-campaign-research-1',dates:['2026-06-21','2026-07-15'],sunsetOffsetsMinutes:[5,30,60],
 initialFuelFractions:[0,.5,1],maxFlights:12,maxExpanded:1200,maxForecasts:15000,horizonDays:7,
 startId:'ULLI',targetId:'UNNT',targetCompletion:'after_turnaround',stockPolicy:'unchanged-academic-campaign-research-v1',
 scope:'Bounded heuristic search; all screened destinations eligible, no gameplay direction lock. Three initial fuel samples per first destination; no waits. A safe shortcut invalidates the scenario, not the physical flight.'});
export const SOUTHERN_SETTINGS=Object.freeze({status:'experimental-alternative-endpoints-not-owner-approved-playable-scenario',
 startId:'SCEL',targetId:'FACT',startUtc:'2026-06-21T22:10:00Z',initialFuelKg:100000,path:['NZCH','YPPH','FACT'],
 stockVersion:'fixed-32000-research-1',stockKgPerAirport:32000,stockProvenance:'Finite experimental game stocks; no change to the canonical campaign stock file or physical aircraft profile',targetCompletion:'after_turnaround'});
// For non-polar, non-opposite meridians a minor great-circle arc has this signed longitude change.
export function longitudeStep(from,to) {
 const delta=((to.longitudeDeg-from.longitudeDeg+540)%360)-180;
 return Math.abs(delta)===180||Math.abs(from.latitudeDeg)===90||Math.abs(to.latitudeDeg)===90?null:delta;
}
export function westwardRouteEvidence(airports,ids) {
 let delta=0;
 for(let i=1;i<ids.length;i++) {
  const step=longitudeStep(airports.find(a=>a.id===ids[i-1]),airports.find(a=>a.id===ids[i]));
  if(step===null)return {status:'indeterminate-polar-longitude',longitudeChangeDeg:null,westwardAroundWorld:false};delta+=step;
 }
 return {status:'resolved',longitudeChangeDeg:delta,westwardAroundWorld:delta<-180};
}
export function replaySouthernWitness(data,path=SOUTHERN_SETTINGS.path) {
 const s={...SOUTHERN_SETTINGS,path},stocks=Object.fromEntries(data.airports.map(a=>[a.id,s.stockKgPerAirport]));
 const world={profile:data.profile,airports:data.airports,targetId:s.targetId,targetCompletion:s.targetCompletion};
 const initial={airportId:s.startId,utcMs:Date.parse(s.startUtc),fuelKg:s.initialFuelKg,stocks,flights:0,distanceKm:0,won:false},before=canonicalJson(initial);
 const direct=forecastResearchFlight(world,initial,s.targetId,CAMPAIGN_SETTINGS.refinedSolar),legs=[],coarse=[];let state=initial;
 for(const to of s.path) {
  const forecast=forecastResearchFlight(world,state,to,CAMPAIGN_SETTINGS.refinedSolar),execution=executeResearchFlight(world,state,to,CAMPAIGN_SETTINGS.refinedSolar);
  if(!execution.allowed||canonicalJson(forecast)!==canonicalJson(execution))throw Error('Southern witness blocked or execution mismatch');
  const ordinary=forecastResearchFlight(world,state,to,CAMPAIGN_SETTINGS.solar);coarse.push({to,status:ordinary.solar.status,sameEnd:ordinary.endUtcMs===execution.endUtcMs});
  legs.push({from:state.airportId,to,startUtcMs:state.utcMs,arrivalUtcMs:execution.arrivalUtcMs,endUtcMs:execution.endUtcMs,distanceKm:execution.distanceKm,
   initialFuelKg:state.fuelKg,flight:execution.flight,refuelling:execution.refuelling,solar:execution.solar,phases:execution.phases});state=execution.next;
 }
 if(before!==canonicalJson(initial))throw Error('Mutated initial stocks');
 const evidence=westwardRouteEvidence(data.airports,[s.startId,...s.path]);
 const polar=data.airports.find(a=>a.id==='ENSB'),polarDays=['2026-06-21','2026-06-22','2026-06-23'].map(date=>({date,certificate:certifyPolarDay(polar,Date.parse(date+'T00:00:00Z'))}));
 if(!evidence.westwardAroundWorld||direct.solar.status!=='unsafe'||direct.solar.phase!=='cruise'||polarDays.some(d=>d.certificate.status!=='safe'))throw Error('Invalid westward scenario criteria');
 return {settings:s,stockSha256:createHash('sha256').update(canonicalJson(stocks)).digest('hex'),evidence,polarDays,
  direct:{allowed:direct.allowed,reasons:direct.reasons,arrivalUtcMs:direct.arrivalUtcMs,solar:direct.solar,solarIndependentOfInitialFuel:true},
  legs,coarse,final:{airportId:state.airportId,utcMs:state.utcMs,fuelKg:state.fuelKg,distanceKm:state.distanceKm,flights:state.flights,won:state.won,
   stockChangesKg:Object.fromEntries(Object.entries(state.stocks).filter(([,kg])=>kg!==s.stockKgPerAirport))},
  interpretation:'Full western multi-refuelling numerical witness with alternative southern endpoints and explicitly different finite game stocks. Not SPB–Novosibirsk, not the science campaign, not an approved playable mission. No food/waiting; shared unchanged physics.'};
}
export function searchWestward(world,data,startUtcMs,settings=WESTWARD_SETTINGS) {
 const byId=new Map(world.airports.map(a=>[a.id,a])),queue=[],witnesses=[],shortcuts=[],counts={expanded:0,forecasts:0,resourceRejected:0,solarRejected:0,indeterminate:0,depthTruncated:0,horizonTruncated:0};
 let firstMoves=0,budgetReached=false;
 const start=campaignState(data,startUtcMs);
 function consider(state,to,path,initialFuelKg) {
  if(counts.forecasts>=settings.maxForecasts){budgetReached=true;return;}
  const from=byId.get(state.airportId),destination=byId.get(to),distance=greatCircle(from,destination).distanceKm;
  if(!aircraftLeg(world.profile,distance,state.fuelKg).dispatchable){counts.resourceRejected++;return;}
  counts.forecasts++;const f=forecastResearchFlight(world,state,to,CAMPAIGN_SETTINGS.refinedSolar);
  if(!f.allowed){if(f.solar.status==='indeterminate')counts.indeterminate++;else if(f.solar.status==='unsafe')counts.solarRejected++;return;}
  const ids=[...path,to],evidence=westwardRouteEvidence(world.airports,['ULLI',...ids]);
  if(f.endUtcMs-startUtcMs>settings.horizonDays*86400000){counts.horizonTruncated++;return;}
  if(ids.length===1)firstMoves++;
  if(to===world.targetId) {
   const result={initialFuelKg,path:ids,evidence,endUtcMs:f.endUtcMs,distanceKm:f.next.distanceKm};
   if(evidence.westwardAroundWorld&&ids.length>=3)witnesses.push(result);else shortcuts.push(result);
   return;
  }
  if(ids.length>=settings.maxFlights){counts.depthTruncated++;return;}
  // Only the exploration order prefers westward progress. It never makes an eastward flight illegal.
  const progress=evidence.longitudeChangeDeg===null?0:-evidence.longitudeChangeDeg;
  queue.push({state:f.next,path:ids,initialFuelKg,priority:progress});
 }
 for(const to of world.airports) {
  if(to.id==='ULLI')continue;const envelope=firstFlightFuelEnvelope(world,'ULLI',to.id);if(!envelope.feasible)continue;
  const low=Math.ceil(envelope.minimumKg),high=Math.floor(envelope.maximumKg);
  if(low>high)continue;
  for(const fuel of new Set(settings.initialFuelFractions.map(f=>Math.floor(low+(high-low)*f))))consider({...start,fuelKg:fuel},to.id,[],fuel);
 }
 while(queue.length&&counts.expanded<settings.maxExpanded&&!budgetReached&&!witnesses.length) {
  queue.sort((a,b)=>b.priority-a.priority);const node=queue.shift();counts.expanded++;
  for(const to of world.airports) {
   if(to.id===node.state.airportId)continue;
   consider(node.state,to.id,node.path,node.initialFuelKg);if(budgetReached)break;
  }
 }
 return {startUtcMs,firstMoves,counts,remaining:queue.length,budgetReached,exhausted:queue.length===0&&!budgetReached&&counts.depthTruncated===0&&counts.horizonTruncated===0,witnesses,shortcuts};
}
export async function researchWestward() {
 const data=await loadCampaignData(),world={profile:data.profile,airports:data.airports.filter(a=>a.suitability.status==='screened-candidate'),targetId:'UNNT',targetCompletion:'after_turnaround'},results=[];
 const from=world.airports.find(a=>a.id==='ULLI'),polar=data.airports.find(a=>a.id==='ENSB');
 for(const date of WESTWARD_SETTINGS.dates) {
  const midnight=Date.parse(date+'T00:00:00Z'),sunset=searchSolarInterval(midnight+12*3600000,midnight+86400000,t=>-solarExposure(from,t).q,ROUTE_MODEL.solarCurvatureBoundPerSecond2,ROUTE_MODEL.evaluationErrorBound,CAMPAIGN_SETTINGS.refinedSolar);
  if(sunset.status!=='unsafe')throw Error('Unresolved sunset');
  const starts=[];
  for(const offset of WESTWARD_SETTINGS.sunsetOffsetsMinutes) {
   const startUtcMs=sunset.witnessUtcMs+offset*60000,direct=forecastResearchFlight(world,campaignState(data,startUtcMs,65000),'UNNT',CAMPAIGN_SETTINGS.refinedSolar);
   starts.push({offsetMinutes:offset,direct:{allowed:direct.allowed,reasons:direct.reasons,solar:direct.solar},search:searchWestward(world,data,startUtcMs)});
  }
  results.push({date,polarDay:certifyPolarDay(polar,midnight),sunset,starts});
 }
 const southernAlternatives=[['YSSY','YPPH','FACT'],['YMML','YPPH','FACT']].map(path=>{
  const r=replaySouthernWitness(data,path);
  return {path,evidence:r.evidence,final:r.final,coarse:r.coarse,legs:r.legs.map(({phases,...leg})=>leg)};
 });
 return {reportVersion:1,settings:WESTWARD_SETTINGS,inputs:(await loadCampaignReport()).inputs,results,southernWitness:replaySouthernWitness(data),southernAlternatives,
  goal:'A physically safe multi-refuelling westward route around Earth; direct eastern flight must be solar-unsafe. Longitude is research evidence, never an artificial flight/mission lock.',
  playableScenarioApproved:false};
}
export async function loadWestwardReport() {
 const report=JSON.parse(await readFile('docs/campaign-research/westward.json','utf8'));
 delete report.southernAlternativesFile;
 report.southernAlternatives=JSON.parse(await readFile('docs/campaign-research/westward-alternatives.json','utf8'));
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const args=process.argv.slice(2);if(args.some(a=>!['--write','--verify'].includes(a))||args.includes('--write')&&args.includes('--verify'))throw Error('Invalid westward research arguments');
  const report=await researchWestward(),path='docs/campaign-research/westward.json';
  if(args.includes('--write')){
   const {southernAlternatives,...main}=report;
   await writeFile('docs/campaign-research/westward-alternatives.json',JSON.stringify(southernAlternatives,null,2)+'\n');
   await writeFile(path,JSON.stringify({...main,southernAlternativesFile:'westward-alternatives.json'},null,2)+'\n');
  }
  if(args.includes('--verify')&&canonicalJson(report)!==canonicalJson(await loadWestwardReport()))throw Error('Westward report differs');
  console.log(JSON.stringify({preferredEndpoints:report.results.map(r=>({date:r.date,starts:r.starts.map(s=>({offset:s.offsetMinutes,directSolar:s.direct.solar.status,...s.search}))})),
   alternative:{settings:report.southernWitness.settings,evidence:report.southernWitness.evidence,final:report.southernWitness.final,directSolar:report.southernWitness.direct.solar.status}},null,2));
 } catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
