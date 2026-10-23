// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadCampaignData} from './campaign-data.mjs';
import {validateCatalog} from './mission-data.mjs';
import {firstFlightEnvelopeAudit} from './mission-research.mjs';
import {forecastResearchFlight,executeResearchFlight,firstFlightFuelEnvelope} from '../dist/core/mission-research.js';
import {solarExposure} from '../dist/core/solar.js';
import {searchSolarInterval} from '../dist/core/interval-search.js';
import {searchStationarySunrise} from '../dist/core/waiting.js';
import {ROUTE_MODEL} from '../dist/core/route.js';
import {SOLAR_MODEL} from '../dist/core/config.js';
import {canonicalJson} from '../dist/core/saves.js';
export const CAMPAIGN_SETTINGS=Object.freeze({version:'academic-first-chapter-research-1',startId:'ULLI',targetId:'UNNT',polarDayLocation:'ENSB',
 targetCompletion:'after_turnaround',referenceInitialFuelKg:65000,selectedDeparture:'2026-08-20T17:35:00Z',
 departureChange:'proposal-requires-owner-review; original-one-hour-before-sunrise-audited-separately',
 dates:['2026-06-21','2026-07-15','2026-08-01','2026-08-10','2026-08-15','2026-08-16','2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22'],
 departureGrid:{startUtcHour:16,endUtcHour:20,stepMinutes:1},
 solar:{eventToleranceSeconds:.5,maxIntervalSeconds:900,maxEvaluations:100000},
 refinedSolar:{eventToleranceSeconds:.05,maxIntervalSeconds:300,maxEvaluations:100000}});
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const compact=f=>({allowed:f.allowed,reasons:f.reasons,distanceKm:f.distanceKm,arrivalUtcMs:f.arrivalUtcMs,endUtcMs:f.endUtcMs,
 solarScope:f.solarScope,solar:f.solar,flight:f.flight,refuelling:f.refuelling});
function snapshot(state,data) {
 const {stocks,...rest}=state;
 return {...rest,stocksReference:'data/campaign/fuel.json',stockChangesKg:Object.fromEntries(Object.entries(stocks).filter(([id,kg])=>kg!==data.fuel.stocks[id]))};
}
export function certifyPolarDay(location,startUtcMs,options=CAMPAIGN_SETTINGS.refinedSolar) {
 // Safe for -q certifies q>0 throughout the day, using the same solar model and conservative derivative bound.
 return searchSolarInterval(startUtcMs,startUtcMs+86400000,t=>-solarExposure(location,t).q,
  ROUTE_MODEL.solarCurvatureBoundPerSecond2,ROUTE_MODEL.evaluationErrorBound,options);
}
export function campaignState(data,utcMs,fuelKg=CAMPAIGN_SETTINGS.referenceInitialFuelKg) {
 return {airportId:'ULLI',utcMs,fuelKg,stocks:{...data.fuel.stocks},flights:0,distanceKm:0,won:false};
}
export async function researchCampaign() {
 const data=await loadCampaignData(),catalogCheck=validateCatalog(data.catalog,data.airports,data.fuel,data.profile),s=CAMPAIGN_SETTINGS;
 const world={profile:data.profile,airports:data.airports,targetId:'UNNT',targetCompletion:'after_turnaround'};
 const from=data.airports.find(a=>a.id==='ULLI'),target=data.airports.find(a=>a.id==='UNNT'),svalbard=data.airports.find(a=>a.id==='ENSB');
 const dates=[];
 for(const date of s.dates) {
  const midnight=Date.parse(date+'T00:00:00Z'),polarDay=certifyPolarDay(svalbard,midnight);
  const sunrise=searchStationarySunrise(from,midnight,s.refinedSolar);
  if(sunrise.status!=='found')throw Error('Unresolved departure sunrise');
  const originalState=campaignState(data,sunrise.eventUtcMs-3600000);
  const firstMoves=firstFlightEnvelopeAudit(world,originalState,s.refinedSolar);
  const samples=[],counts={};
  for(let minute=s.departureGrid.startUtcHour*60;minute<=s.departureGrid.endUtcHour*60;minute+=s.departureGrid.stepMinutes) {
   const state=campaignState(data,midnight+minute*60000),f=forecastResearchFlight(world,state,'UNNT',s.refinedSolar);
   counts[f.solar.status]=(counts[f.solar.status]??0)+1;if(f.allowed)samples.push(state.utcMs);
  }
  dates.push({date,polarDay,originalOneHourStart:{utcMs:originalState.utcMs,sunriseUtcMs:sunrise.eventUtcMs,counts:firstMoves.counts,
   firstMoveRuledOutWithinCatalog:firstMoves.firstMoveRuledOutWithinCatalog,
   potentialOrUnresolved:firstMoves.entries.filter(e=>!['unverified_airport','empty_legal_fuel_interval','sun_even_at_fastest_ground_turn'].includes(e.classification)).map(e=>({to:e.to,classification:e.classification}))},
   directDepartureSamples:{counts,safeCount:samples.length,firstUtcMs:samples[0]??null,lastUtcMs:samples.at(-1)??null,
    continuousDepartureWindowCertified:false,grid:s.departureGrid}});
 }
 const initial=campaignState(data,Date.parse(s.selectedDeparture)),before=structuredClone(initial);
 const selected=forecastResearchFlight(world,initial,'UNNT',s.refinedSolar),coarse=forecastResearchFlight(world,initial,'UNNT',s.solar);
 const execution=executeResearchFlight(world,initial,'UNNT',s.refinedSolar);
 if(canonicalJson(selected)!==canonicalJson(execution)||canonicalJson(initial)!==canonicalJson(before))throw Error('Execution/immutability disagreement');
 if(!selected.allowed)throw Error('Selected first chapter has no safe transition');
 const nextSunrise=searchStationarySunrise(target,selected.endUtcMs,s.refinedSolar);
 const continuationWorld={...world,targetId:'RJTT'},continuationState={...selected.next,won:false};
 const outgoing=[],outgoingCounts={};
 for(const to of data.airports.filter(a=>a.suitability.status==='screened-candidate'&&a.id!=='UNNT')) {
  const f=forecastResearchFlight(continuationWorld,continuationState,to.id,s.refinedSolar);
  const key=f.allowed?'allowed':f.reasons.join('+');outgoingCounts[key]=(outgoingCounts[key]??0)+1;
  if(f.allowed)outgoing.push({to:to.id,...compact(f)});
 }
 const southernProbes=[];
 for(const to of ['SBGR','SAEZ','SUMU','SCEL','FACT','FAOR']) {
  const envelope=firstFlightFuelEnvelope(world,'ULLI',to),state={...initial,fuelKg:Math.floor(envelope.maximumKg)};
  southernProbes.push({to,initialFuelKg:state.fuelKg,envelope,...compact(forecastResearchFlight(world,state,to,s.refinedSolar))});
 }
 return {reportVersion:1,settings:s,solarModel:SOLAR_MODEL.version,routeModel:ROUTE_MODEL.version,
  inputs:{catalogSource:data.catalog.source,profileId:data.profile.id,profileVersion:data.profile.profileVersion,seed:data.fuel.seed,
   sha256:{catalog:hash(data.catalog),airports:hash(data.airports),profile:hash(data.profile),stocks:hash(data.fuel)}},catalogCheck,
  endpoints:{from,target,svalbard},fuelEnvelope:firstFlightFuelEnvelope(world,'ULLI','UNNT'),dates,
  witness:{initial:snapshot(initial,data),...compact(selected),next:snapshot(selected.next,data),phases:selected.phases,
   nextSunrise,postTurnaroundNightSeconds:nextSunrise.status==='found'?(nextSunrise.eventUtcMs-selected.endUtcMs)/1000:null,
   refinement:{coarseStatus:coarse.solar.status,refinedStatus:selected.solar.status,sameEnd:coarse.endUtcMs===selected.endUtcMs}},
  continuation:{state:snapshot(continuationState,data),testedDestinations:Object.values(outgoingCounts).reduce((a,b)=>a+b,0),counts:outgoingCounts,allowed:outgoing,
   scope:'single-next-flight-only; no waiting; same full-tank rules; no knowledge transfer time or later campaign proven'},
  southernProbes,result:{firstChapterFlightAndTurnaroundCertified:true,firstChapterPlayableApproved:false,fullCampaignCertified:false,
   scope:'A numerical first-chapter witness under a proposed night departure, not a proof of the campaign or of airport operational approval. Sampled departure windows are not continuous-window certificates. Food/waiting/laboratory transfers are not modelled.'}};
}
const reportParts=['dates','witness','continuation','southernProbes'];
export async function loadCampaignReport() {
 const report=JSON.parse(await readFile('docs/campaign-research/report.json','utf8'));
 for(const part of reportParts)report[part]=JSON.parse(await readFile('docs/campaign-research/'+part+'.json','utf8'));
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const args=process.argv.slice(2);if(args.some(a=>!['--write','--verify'].includes(a))||args.includes('--write')&&args.includes('--verify'))throw Error('Invalid campaign research arguments');
  const report=await researchCampaign();
  if(args.includes('--write')){
   await mkdir('docs/campaign-research',{recursive:true});const metadata={...report};
   for(const part of reportParts){await writeFile('docs/campaign-research/'+part+'.json',JSON.stringify(report[part],null,2)+'\n');delete metadata[part];}
   await writeFile('docs/campaign-research/report.json',JSON.stringify(metadata,null,2)+'\n');
  }
  if(args.includes('--verify')&&canonicalJson(report)!==canonicalJson(await loadCampaignReport()))throw Error('Campaign report differs');
  console.log(JSON.stringify({result:report.result,witness:{departure:report.settings.selectedDeparture,arrival:new Date(report.witness.arrivalUtcMs).toISOString(),ready:new Date(report.witness.endUtcMs).toISOString()},continuation:{tested:report.continuation.testedDestinations,allowed:report.continuation.allowed.map(a=>a.to)},originalStarts:report.dates.map(d=>({date:d.date,ruledOut:d.originalOneHourStart.firstMoveRuledOutWithinCatalog,potential:d.originalOneHourStart.potentialOrUnresolved})),verified:args.includes('--verify')},null,2));
 } catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
}
