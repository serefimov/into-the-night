// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
import {forecastMissionFlight} from '../dist/core/mission-flight.js';
import {canonicalJson} from '../dist/core/serialization.js';
import {certifyPolarDay} from './campaign-research.mjs';
import {solarExposure} from '../dist/core/solar.js';
export const DISPATCH_RESEARCH_OPTIONS={eventToleranceSeconds:.05,maxIntervalSeconds:300,maxEvaluations:100000};
export const loadDepartureReport=async()=>JSON.parse(await readFile('docs/departure-fuel/report.json','utf8'));
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export async function researchDepartureFuel(){
 const d=await loadCycleDefinition('data/scenarios/westward-control-v2.json'),initial={...structuredClone(d.initial),flights:0,distanceKm:0,won:false},routes=[];
 for(const first of ['NZCH','YSSY','YMML']){
  let state=structuredClone(initial);const legs=[];
  for(const to of [first,'YPPH','FACT']){
   const f=forecastMissionFlight(d,state,to,DISPATCH_RESEARCH_OPTIONS),ordinary=forecastMissionFlight(d,state,to);
   if(!f.allowed||!ordinary.allowed)throw Error('Blocked control route: '+first+' / '+to+' '+f.reasons);
   legs.push({from:state.airportId,to,startUtcMs:state.utcMs,departureUtcMs:f.departureUtcMs,arrivalUtcMs:f.arrivalUtcMs,endUtcMs:f.endUtcMs,distanceKm:f.distanceKm,
    flight:f.flight,refuelling:f.refuelling,solar:f.solar,refinement:{sameEnd:f.endUtcMs===ordinary.endUtcMs,ordinaryStatus:ordinary.solar.status}});state=f.next;
  }
  routes.push({path:[first,'YPPH','FACT'],legs,final:{utcMs:state.utcMs,fuelKg:state.fuelKg,distanceKm:state.distanceKm,flights:state.flights,won:state.won},
   stocks:Object.fromEntries(['SCEL',first,'YPPH','FACT'].map(id=>[id,state.stocks[id]]))});
 }
 const direct=forecastMissionFlight(d,initial,'FACT',DISPATCH_RESEARCH_OPTIONS),polar=d.airports.find(a=>a.id==='ENSB');
 if(direct.solar.status!=='unsafe'||direct.solar.phase==='refuelling')throw Error('Eastern control must meet Sun during flight');
 const polarDays=['2026-06-21','2026-06-22','2026-06-23'].map(date=>({date,certificate:certifyPolarDay(polar,Date.parse(date+'T00:00:00Z'))}));
 if(polarDays.some(p=>p.certificate.status!=='safe')||!solarExposure(d.airports.find(a=>a.id==='SCEL'),initial.utcMs).safe)throw Error('Invalid seasonal control');
 return {reportVersion:1,mode:'airport-flight-v2',rule:'Fuel for selected flight + arrival service + existing profile reserve, no unloading of existing fuel',scenarioId:d.scenarioId,scenarioVersion:d.scenarioVersion,seed:d.seed,stockVersion:d.stockVersion,
  initial:{airportId:initial.airportId,utcMs:initial.utcMs,fuelKg:initial.fuelKg},worldVersion:d.worldVersion,profileId:d.profile.id,profileVersion:d.profile.profileVersion,
  inputsSha256:{definition:hash(d),profile:hash(d.profile),stocks:hash(initial.stocks)},direct:{allowed:direct.allowed,reasons:direct.reasons,solar:direct.solar},polarDays,routes,
  scope:'Three verified western control chains under new dispatch rule, not an exhaustive search or approval of the science campaign. All historical reports remain on their original rules.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);if(args.some(a=>!['--write','--verify'].includes(a))||args.includes('--write')&&args.includes('--verify'))throw Error('Invalid dispatch research arguments');
  const r=await researchDepartureFuel();if(args.includes('--write')){await mkdir('docs/departure-fuel',{recursive:true});await writeFile('docs/departure-fuel/report.json',JSON.stringify(r,null,2)+'\n');}
  if(args.includes('--verify')&&canonicalJson(r)!==canonicalJson(await loadDepartureReport()))throw Error('Departure fuel report differs');
  console.log(JSON.stringify({mode:r.mode,initial:r.initial,direct:r.direct,controls:r.routes.map(p=>({path:p.path,endUtc:new Date(p.final.utcMs).toISOString(),fuelKg:p.final.fuelKg,stocks:p.stocks})),verified:args.includes('--verify')},null,2));
 }catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
