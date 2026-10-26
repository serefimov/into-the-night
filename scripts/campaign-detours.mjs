// SPDX-License-Identifier: GPL-3.0-only
// Optional, substantially slower bounded research; not part of the interactive game or normal checks.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadCampaignData} from './campaign-data.mjs';
import {CAMPAIGN_SETTINGS,campaignState,researchCampaign} from './campaign-research.mjs';
import {boundedRouteSearch} from './mission-research.mjs';
import {forecastResearchFlight,firstFlightFuelEnvelope} from '../dist/core/mission-research.js';
import {canonicalJson} from '../dist/core/saves.js';
import {SOLAR_MODEL} from '../dist/core/config.js';
import {ROUTE_MODEL} from '../dist/core/route.js';
export const DETOUR_SETTINGS=Object.freeze({departures:['2026-06-21T19:40:00Z','2026-07-15T19:15:00Z','2026-08-01T18:30:00Z'],
 initialFuelPolicy:'floor-of-legal-maximum-for-each-first-destination',afterFirst:{maxFlights:5,maxExpanded:250,horizonDays:4}});
export function summarizeDetours(raw,inputs) {
 return {reportVersion:1,inputs,settings:DETOUR_SETTINGS,solarModel:SOLAR_MODEL.version,routeModel:ROUTE_MODEL.version,
  solarOptions:CAMPAIGN_SETTINGS.refinedSolar,targetCompletion:'after_turnaround',
  scope:'At most 6 flights; horizon measured from end of first turnaround; one initial fuel per first destination; fixed departure samples. Not exhaustive over dates, fuel, airports or longer paths.',
  dates:raw.map(r=>({departure:r.date,firstMoveCount:r.roots,
   firstMoves:r.results.map(x=>[x.first,x.initialFuelKg]),
   expanded:r.results.reduce((sum,x)=>sum+(x.expanded??0),0),
   truncated:r.results.reduce((sum,x)=>sum+(x.truncated??0),0),
   remaining:r.results.reduce((sum,x)=>sum+(x.remaining??0),0),
   rootsLimited:r.results.filter(x=>!x.direct&&!x.exhausted).map(x=>x.first),
   solutions:r.results.flatMap(x=>x.direct?[{initialFuelKg:x.initialFuelKg,path:[x.first]}]:x.solutions.map(sol=>({initialFuelKg:x.initialFuelKg,path:[x.first,...sol.path],endUtcMs:sol.state?.utcMs??sol.utcMs})))}))};
}
export async function researchDetours() {
 const data=await loadCampaignData(),world={profile:data.profile,airports:data.airports,targetId:'UNNT',targetCompletion:'after_turnaround'},raw=[];
 for(const date of DETOUR_SETTINGS.departures) {
  const state=campaignState(data,Date.parse(date)),results=[];
  for(const to of data.airports.filter(a=>a.suitability.status==='screened-candidate'&&a.id!=='ULLI')) {
   const envelope=firstFlightFuelEnvelope(world,'ULLI',to.id);if(!envelope.feasible)continue;
   const initial={...state,fuelKg:Math.floor(envelope.maximumKg)},f=forecastResearchFlight(world,initial,to.id,CAMPAIGN_SETTINGS.refinedSolar);
   if(!f.allowed)continue;
   if(f.next.won){results.push({first:to.id,initialFuelKg:initial.fuelKg,direct:true});continue;}
   const {rootChoices,...search}=boundedRouteSearch(world,f.next,DETOUR_SETTINGS.afterFirst,CAMPAIGN_SETTINGS.refinedSolar);
   results.push({first:to.id,initialFuelKg:initial.fuelKg,...search});
  }
  raw.push({date,roots:results.length,results});
 }
 return summarizeDetours(raw,(await researchCampaign()).inputs);
}
export async function writeDetourReport(report) {
 const dates=[];
 for(const [index,date] of report.dates.entries()) {
  const {firstMoves,...summary}=date,firstMovesFile='detours-'+(index+1)+'.json';
  await writeFile('docs/campaign-research/'+firstMovesFile,JSON.stringify(firstMoves,null,2)+'\n');dates.push({...summary,firstMovesFile});
 }
 await writeFile('docs/campaign-research/detours.json',JSON.stringify({...report,dates},null,2)+'\n');
}
export async function loadDetourReport() {
 const report=JSON.parse(await readFile('docs/campaign-research/detours.json','utf8'));
 for(const [index,date] of report.dates.entries()) {
  const {firstMovesFile,...summary}=date;
  report.dates[index]={...summary,firstMoves:JSON.parse(await readFile('docs/campaign-research/detours-'+(index+1)+'.json','utf8'))};
 }
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const args=process.argv.slice(2);if(args.some(a=>!['--write','--verify'].includes(a))||args.includes('--write')&&args.includes('--verify'))throw Error('Invalid detour research arguments');
  const report=await researchDetours();
  if(args.includes('--write'))await writeDetourReport(report);
  if(args.includes('--verify')&&canonicalJson(report)!==canonicalJson(await loadDetourReport()))throw Error('Detour report differs');
  console.log(JSON.stringify(report.dates.map(d=>({departure:d.departure,firstMoves:d.firstMoveCount,expanded:d.expanded,truncated:d.truncated,remaining:d.remaining,solutions:d.solutions})),null,2));
 } catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
