// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadMissionData,validateCatalog} from './mission-data.mjs';
import {aircraftMetrics} from '../dist/core/aircraft.js';
import {searchStationarySunrise} from '../dist/core/waiting.js';
import {forecastResearchFlight,executeResearchFlight,firstFlightFuelEnvelope,RESEARCH_MODEL} from '../dist/core/mission-research.js';
import {SOLAR_MODEL} from '../dist/core/config.js';
import {ROUTE_MODEL} from '../dist/core/route.js';
import {canonicalJson} from '../dist/core/saves.js';
export const RESEARCH_SETTINGS=Object.freeze({status:'research-only-not-an-approved-playable-scenario',date:'2026-06-21',startAirportId:'KJFK',targetId:'EGLL',referenceInitialFuelKg:50000,
 search:{maxFlights:8,maxExpanded:5000,horizonDays:7},solar:{eventToleranceSeconds:.5,maxIntervalSeconds:900,maxEvaluations:100000},refinedSolar:{eventToleranceSeconds:.05,maxIntervalSeconds:300,maxEvaluations:100000}});
const fingerprint=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export function candidateStart(world,data,date,options) {
 const jfk=world.airports.find(a=>a.id==='KJFK');
 // Start the sunrise search at local civil midnight (04:00Z in June), not an already sunlit UTC midnight.
 const sunrise=searchStationarySunrise(jfk,Date.parse(date+'T04:00:00Z'),options);
 if(sunrise.status!=='found')throw Error('JFK sunrise is unresolved: '+sunrise.status);
 return {sunrise,state:{airportId:'KJFK',utcMs:sunrise.eventUtcMs-3600000,fuelKg:RESEARCH_SETTINGS.referenceInitialFuelKg,stocks:{...data.fuel.stocks},flights:0,distanceKm:0,won:false}};
}
function compact(forecast) {return {allowed:forecast.allowed,reasons:forecast.reasons,distanceKm:forecast.distanceKm,arrivalUtcMs:forecast.arrivalUtcMs,endUtcMs:forecast.endUtcMs,
 solarScope:forecast.solarScope,solar:forecast.solar,arrivalFuelKg:forecast.flight.arrivalFuelKg,landingMassKg:forecast.flight.landingMassKg,refuelling:forecast.refuelling};}
export function firstFlightEnvelopeAudit(world,state,options) {
 const entries=[];
 for(const to of [...world.airports].sort((a,b)=>a.id.localeCompare(b.id))) {
  if(to.id===state.airportId)continue;
  if(to.suitability.status!=='screened-candidate'){entries.push({to:to.id,classification:'unverified_airport'});continue;}
  const envelope=firstFlightFuelEnvelope(world,state.airportId,to.id);
  if(!envelope.feasible){entries.push({to:to.id,classification:'empty_legal_fuel_interval',...envelope});continue;}
  // This optimistic endpoint can exceed a strict mass comparison by roundoff.
  // It is a lower bound on refuelling duration, never offered as an executable route.
  const best=forecastResearchFlight(world,{...state,fuelKg:envelope.maximumKg},to.id,options);
  entries.push({to:to.id,classification:best.solar.status==='unsafe'?'sun_even_at_fastest_ground_turn':best.allowed?'potential_first_move':'unresolved',...envelope,...compact(best)});
 }
 const counts={};for(const e of entries)counts[e.classification]=(counts[e.classification]??0)+1;
 return {counts,firstMoveRuledOutWithinCatalog:entries.every(e=>['unverified_airport','empty_legal_fuel_interval','sun_even_at_fastest_ground_turn'].includes(e.classification)),entries};
}
export function boundedRouteSearch(world,initial,limits,solar) {
 if(!Number.isInteger(limits.maxFlights)||limits.maxFlights<1||limits.maxFlights>1000||!Number.isInteger(limits.maxExpanded)||limits.maxExpanded<1||limits.maxExpanded>1000000||!Number.isFinite(limits.horizonDays)||limits.horizonDays<=0)throw Error('Invalid search limits');
 const stack=[{state:structuredClone(initial),path:[]}],solutions=[];let expanded=0,truncated=0,rejected=0;
 const rootChoices=[];
 while(stack.length&&expanded<limits.maxExpanded) {
  const node=stack.pop();expanded++;
  for(const to of [...world.airports].sort((a,b)=>a.id.localeCompare(b.id))) {
   if(to.id===node.state.airportId||to.suitability.status!=='screened-candidate')continue;
   const forecast=forecastResearchFlight(world,node.state,to.id,solar);
   if(node.path.length===0)rootChoices.push({to:to.id,...compact(forecast)});
   if(!forecast.allowed){rejected++;continue;}
   if(forecast.endUtcMs-initial.utcMs>limits.horizonDays*86400000){truncated++;continue;}
   const execution=executeResearchFlight(world,node.state,to.id,solar);
   if(canonicalJson(forecast)!==canonicalJson(execution))throw Error('Forecast and execution disagree');
   const path=[...node.path,to.id];
   if(execution.next.won){solutions.push({path,state:execution.next});continue;}
   if(path.length>=limits.maxFlights){truncated++;continue;}
   stack.push({state:execution.next,path});
  }
 }
 return {limits,expanded,truncated,remaining:stack.length,rejected,rootChoices,solutions,exhausted:stack.length===0&&truncated===0};
}
export async function researchMission() {
 const data=await loadMissionData();validateCatalog(data.catalog,data.airports,data.fuel,data.profile);
 const world={profile:data.profile,airports:data.airports,targetId:'EGLL'},start=candidateStart(world,data,RESEARCH_SETTINGS.date,RESEARCH_SETTINGS.solar);
 const refined=candidateStart(world,data,RESEARCH_SETTINGS.date,RESEARCH_SETTINGS.refinedSolar);
 const envelope=firstFlightEnvelopeAudit(world,start.state,RESEARCH_SETTINGS.solar),tight=firstFlightEnvelopeAudit(world,refined.state,RESEARCH_SETTINGS.refinedSolar);
 const search=boundedRouteSearch(world,start.state,RESEARCH_SETTINGS.search,RESEARCH_SETTINGS.solar);
 const dateChecks=[];for(const date of ['2026-06-14','2026-06-28','2027-06-21']) {const s=candidateStart(world,data,date,RESEARCH_SETTINGS.refinedSolar),r=firstFlightEnvelopeAudit(world,s.state,RESEARCH_SETTINGS.refinedSolar);dateChecks.push({date,startUtcMs:s.state.utcMs,sunriseUtcMs:s.sunrise.eventUtcMs,counts:r.counts,firstMoveRuledOutWithinCatalog:r.firstMoveRuledOutWithinCatalog});}
 const perturbations=[];
 for(const [label,ground,burn,refuelling] of [['ground-20pct',.8,1,1],['ground+20pct',1.2,1,1],['burn-10pct',1,.9,1],['burn+10pct',1,1.1,1],['refuelling-20pct',1,1,.8],['refuelling+20pct',1,1,1.2],['combined-optimistic',.8,.9,1.2],['combined-pessimistic',1.2,1.1,.8]]) {
  const profile=structuredClone(data.profile),a=profile.assumptions;
  for(const key of ['departureSeconds','arrivalSeconds','serviceSeconds','refuellingSetupSeconds'])a[key]*=ground;
  for(const key of ['cruiseBurnKgPerKm','departureBurnKg','arrivalBurnKg'])a[key]*=burn;
  a.refuellingLitresPerMinute*=refuelling;
  const r=firstFlightEnvelopeAudit({...world,profile},refined.state,RESEARCH_SETTINGS.refinedSolar);
  perturbations.push({label,groundMultiplier:ground,burnMultiplier:burn,refuellingMultiplier:refuelling,counts:r.counts,firstMoveRuledOutWithinCatalog:r.firstMoveRuledOutWithinCatalog,
   unresolvedOrPotential:r.entries.filter(e=>!['unverified_airport','empty_legal_fuel_interval','sun_even_at_fastest_ground_turn'].includes(e.classification))});
 }
 const startLeadChecks=[];
 for(const leadHours of [2,3,6,9]) {
  const state={...refined.state,utcMs:refined.sunrise.eventUtcMs-leadHours*3600000};
  const r=firstFlightEnvelopeAudit(world,state,RESEARCH_SETTINGS.refinedSolar);
  startLeadChecks.push({counterfactualNotApproved:true,leadHours,startUtcMs:state.utcMs,counts:r.counts,
   potentialFirstMoves:r.entries.filter(e=>e.classification==='potential_first_move').map(e=>({to:e.to,initialFuelKg:e.maximumKg})),
   unresolved:r.entries.filter(e=>e.classification==='unresolved').map(e=>e.to),fullMissionFeasibility:'not-researched-for-this-change'});
 }
 const {rootChoices,...searchSummary}=search;
 const probes=['EGLL','BIKF','PANC','KLAX','KIAD','KORD','KATL'].map(to=>({to,reference:rootChoices.find(e=>e.to===to),optimisticAllFuelBound:tight.entries.find(e=>e.to===to)}));
 return {reportVersion:1,model:RESEARCH_MODEL,solarModel:SOLAR_MODEL.version,routeModel:ROUTE_MODEL.version,settings:RESEARCH_SETTINGS,
  inputs:{catalogSource:data.catalog.source,profileId:data.profile.id,profileVersion:data.profile.profileVersion,seed:data.fuel.seed,sha256:{catalog:fingerprint(data.catalog),airports:fingerprint(data.airports),profile:fingerprint(data.profile),stocks:fingerprint(data.fuel)}},
  start:{utcMs:start.state.utcMs,iso:new Date(start.state.utcMs).toISOString(),initialFuelKg:start.state.fuelKg,groundState:RESEARCH_MODEL.initialGroundState,sunrise:start.sunrise},
  aircraft:aircraftMetrics(data.profile),result:{status:envelope.firstMoveRuledOutWithinCatalog&&tight.firstMoveRuledOutWithinCatalog?'no-first-move-within-current-catalog-and-profile':'no-solution-in-bounded-search',playableScenarioApproved:false,requiresOwnerDecision:true,successfulRoutes:search.solutions.length},
  envelope: {counts:envelope.counts,allFuelIntervalsCovered:true,proofScope:'Only screened airports in this pinned catalog, this fixed phase/fuel model and dates individually checked; no claim about all real airports or actual AFM performance.'},
  refinement:{startShiftMs:refined.state.utcMs-start.state.utcMs,sunriseBracket:refined.sunrise.bracketUtcMs,counts:tight.counts,
   sameClassifications:envelope.entries.every(e=>tight.entries.find(t=>t.to===e.to)?.classification===e.classification),maxEventShiftSeconds:Math.max(0,...envelope.entries.map(e=>{const t=tight.entries.find(t=>t.to===e.to);return e.solar?.eventUtcMs!=null&&t?.solar?.eventUtcMs!=null?Math.abs(e.solar.eventUtcMs-t.solar.eventUtcMs)/1000:0;}))},
  search:searchSummary,probes,dateChecks,perturbations,startLeadChecks,firstFlightEnvelope:tight.entries};
}
export async function replayResearchPath(path,options=RESEARCH_SETTINGS.refinedSolar) {
 if(!Array.isArray(path)||!path.every(id=>typeof id==='string'))throw Error('Path must be a JSON array of airport IDs');
 const data=await loadMissionData(),world={profile:data.profile,airports:data.airports,targetId:'EGLL'},start=candidateStart(world,data,RESEARCH_SETTINGS.date,options);let state=start.state;const stages=[];
 for(const destinationId of path){const prediction=forecastResearchFlight(world,state,destinationId,options),execution=executeResearchFlight(world,state,destinationId,options);if(canonicalJson(prediction)!==canonicalJson(execution))throw Error('Replay diverged');stages.push({destinationId,...compact(execution)});if(!execution.allowed)return {outcome:'blocked',stages,state};state=execution.next;}
 return {outcome:state.won?'won':'incomplete',stages,state};
}
export async function saveResearchReport(report) {
 await mkdir('docs/mission-research',{recursive:true});const data=await loadMissionData(),regions=data.catalog.regions;
 const {firstFlightEnvelope,...summary}=report;summary.firstFlightEnvelopeFiles=[];
 for(const region of regions){const ids=new Set(data.airports.filter(a=>a.continent===region).map(a=>a.id)),file=region+'.json';await writeFile('docs/mission-research/'+file,JSON.stringify(firstFlightEnvelope.filter(e=>ids.has(e.to)),null,2)+'\n');summary.firstFlightEnvelopeFiles.push(file);}
 await writeFile('docs/mission-research/report.json',JSON.stringify(summary,null,2)+'\n');
}
export async function loadResearchReport() {
 const {firstFlightEnvelopeFiles,...summary}=JSON.parse(await readFile('docs/mission-research/report.json','utf8'));
 if(!Array.isArray(firstFlightEnvelopeFiles)||firstFlightEnvelopeFiles.some(f=>!/^(AF|AS|EU|NA|OC|SA)\.json$/.test(f)))throw Error('Invalid report paths');
 const firstFlightEnvelope=(await Promise.all(firstFlightEnvelopeFiles.map(f=>readFile('docs/mission-research/'+f,'utf8').then(JSON.parse)))).flat().sort((a,b)=>a.to.localeCompare(b.to));
 // The archived v1 report contains one full-tank sum 1 ULP above capacity.
 // Keep the source artifact unchanged; adapt only that roundoff on read after the capacity fix.
 const capacity=aircraftMetrics((await loadMissionData()).profile).fuelCapacityKg;
 const report={...summary,firstFlightEnvelope};
 function normalize(value) {
  if(!value||typeof value!=='object')return;
  const r=value.refuelling;
  if(r&&r.fuelKg>capacity&&r.fuelKg-capacity<=Number.EPSILON*capacity)r.fuelKg=capacity;
  for(const child of Object.values(value))normalize(child);
 }
 normalize(report);return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  if(process.argv[2]==='--research') {
   if(process.argv.length>4||(process.argv.length===4&&!['--write','--verify'].includes(process.argv[3])))throw Error('Invalid research arguments');
   const report=await researchMission();
   if(process.argv[3]==='--write'){await saveResearchReport(report);console.log(JSON.stringify({written:'docs/mission-research/report.json',...report.result,counts:report.envelope.counts}));}
   else if(process.argv[3]==='--verify'){const saved=await loadResearchReport();if(canonicalJson(report)!==canonicalJson(saved))throw Error('Research report differs from pinned result');console.log(JSON.stringify({passed:true,...report.result}));}
   else console.log(JSON.stringify(report,null,2));
  } else if(process.argv[2]==='--path'&&process.argv.length===4){const result=await replayResearchPath(JSON.parse(await readFile(process.argv[3],'utf8')));console.log(JSON.stringify(result,null,2));if(result.outcome==='blocked')process.exitCode=2;}
  else throw Error('Use --research [--write|--verify] | --path PATH.json');
 }catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
}
