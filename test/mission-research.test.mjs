// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {loadMissionData} from '../scripts/mission-data.mjs';
import {candidateStart,RESEARCH_SETTINGS,firstFlightEnvelopeAudit,boundedRouteSearch,researchMission,loadResearchReport} from '../scripts/mission-research.mjs';
import {forecastResearchFlight,executeResearchFlight,firstFlightFuelEnvelope,auditResearchPhases} from '../dist/core/mission-research.js';
import {solarExposure} from '../dist/core/solar.js';
import {aircraftMetrics} from '../dist/core/aircraft.js';
const data=await loadMissionData(),world={profile:data.profile,airports:data.airports,targetId:'EGLL'},settings=RESEARCH_SETTINGS;
const start=candidateStart(world,data,settings.date,settings.refinedSolar);
function polarWorld() {
 const profile=structuredClone(data.profile);profile.id='synthetic-polar-transition-test';profile.assumptions.zeroFuelKg=60000;
 const airports=[{id:'A',latitudeDeg:-80,longitudeDeg:0,suitability:{status:'screened-candidate'}},{id:'B',latitudeDeg:-80,longitudeDeg:90,suitability:{status:'screened-candidate'}},{id:'C',latitudeDeg:-80,longitudeDeg:180,suitability:{status:'screened-candidate'}}];
 return {world:{profile,airports,targetId:'C'},state:{airportId:'A',utcMs:Date.parse('2026-06-21T00:00:00Z'),fuelKg:30000,stocks:{A:50000,B:30000,C:100000},flights:0,distanceKm:0,won:false}};
}

test('JFK start is one hour before the shared geometric sunrise with a localized bracket',()=>{
 const jfk=data.airports.find(a=>a.id==='KJFK');assert.equal(start.sunrise.eventUtcMs-start.state.utcMs,3600000);
 assert.ok(solarExposure(jfk,start.state.utcMs).safe);assert.ok(start.sunrise.eventUtcMs>Date.parse('2026-06-21T09:29:31Z')&&start.sunrise.eventUtcMs<Date.parse('2026-06-21T09:29:34Z'));
 assert.ok(start.sunrise.timeErrorBoundSeconds<=.05);assert.ok(solarExposure(jfk,start.sunrise.eventUtcMs).q>=0);
});

test('all legal initial fuel for IAD shares a flight and longer refuelling never improves the earliest-Sun result',()=>{
 const bounds=firstFlightFuelEnvelope(world,'KJFK','KIAD');assert.ok(bounds.feasible);let last=Infinity;
 for(const fraction of [0,.25,.5,.75,1]) {
  const fuelKg=bounds.minimumKg+fraction*(bounds.maximumKg-bounds.minimumKg),state={...start.state,fuelKg};
  const f=forecastResearchFlight(world,state,'KIAD',settings.refinedSolar);assert.equal(f.solar.status,'unsafe');assert.equal(f.solar.phase,'refuelling');
  assert.ok(f.endUtcMs<=last);last=f.endUtcMs;assert.equal(f.solarScope,'automatic_turnaround');
 }
 assert.ok(last>start.state.utcMs+3600000);
});

test('a safe polar transition conserves fuel/stocks, handles repeated visits and matches execution without mutating input',()=>{
 const {world:w,state:initial}=polarWorld();let state=initial,totalBurn=0;const before=structuredClone(initial),initialTotal=initial.fuelKg+Object.values(initial.stocks).reduce((a,b)=>a+b,0);
 for(const destination of ['B','A','B']) {
  const f=forecastResearchFlight(w,state,destination),e=executeResearchFlight(w,state,destination);assert.ok(f.allowed);assert.deepEqual(f,e);
  totalBurn+=e.flight.burnKg;state=e.next;
 }
 assert.deepEqual(initial,before);assert.equal(state.stocks.B,0);assert.equal(state.flights,3);
 assert.ok(Math.abs(state.fuelKg+Object.values(state.stocks).reduce((a,b)=>a+b,0)+totalBurn-initialTotal)<1e-8);
});

test('safe target arrival wins before unnecessary service/refuelling; Sun at the terminal boundary is unsafe',()=>{
 const {world:w,state}=polarWorld();w.targetId='B';const f=forecastResearchFlight(w,state,'B');assert.ok(f.allowed);assert.equal(f.next.won,true);assert.equal(f.endUtcMs,f.arrivalUtcMs);assert.equal(f.refuelling,null);assert.equal(f.solarScope,'terminal_arrival');assert.equal(f.next.stocks.B,state.stocks.B);
 const jfk=data.airports.find(a=>a.id==='KJFK'),t=start.sunrise.eventUtcMs;
 const audit=auditResearchPhases([{label:'arrival',route:{kind:'landing',legIndex:0,startUtcMs:t,endUtcMs:t,location:jfk,path:null}}]);assert.equal(audit.status,'unsafe');assert.equal(audit.eventUtcMs,t);
 const london=forecastResearchFlight(world,start.state,'EGLL');assert.equal(london.next,null);assert.equal(london.solarScope,'terminal_arrival');assert.equal(london.solar.status,'unsafe');
});

test('blocked/invalid choices leave state untouched and resource rejection does not advertise a complete solar forecast',()=>{
 const before=structuredClone(start.state);const f=executeResearchFlight(world,start.state,'KLAX');assert.equal(f.allowed,false);assert.equal(f.next,null);assert.deepEqual(start.state,before);
 const invalid=forecastResearchFlight(world,{...start.state,fuelKg:1},'KIAD');assert.equal(invalid.allowed,false);assert.equal(invalid.solarScope,'flight_only_invalid_resources');
 assert.throws(()=>forecastResearchFlight(world,{...start.state,stocks:{...start.state.stocks,KIAD:NaN}},'KIAD'));
 assert.throws(()=>boundedRouteSearch(world,start.state,{maxFlights:0,maxExpanded:1,horizonDays:1},{}));
});

test('bounded search reports truncation separately from exhaustion and never discards stock history by airport alone',()=>{
 const {world:w,state}=polarWorld(),r=boundedRouteSearch(w,state,{maxFlights:1,maxExpanded:5,horizonDays:7},{});
 assert.ok(r.solutions.some(s=>s.path[0]==='C'));assert.ok(r.truncated>0);assert.equal(r.exhausted,false);
 const short=boundedRouteSearch(w,state,{maxFlights:5,maxExpanded:5,horizonDays:.00001},{});assert.equal(short.solutions.length,0);assert.ok(short.truncated>0);
});

test('every screened first destination is audited; refined and sensitivity results retain explicit bounded scope',async()=>{
 const r=await researchMission(),saved=await loadResearchReport();assert.deepEqual(r,saved);
 assert.equal(r.firstFlightEnvelope.length,data.airports.length-1);assert.deepEqual(r.envelope.counts,{sun_even_at_fastest_ground_turn:92,empty_legal_fuel_interval:9,unverified_airport:5});
 assert.equal(r.result.playableScenarioApproved,false);assert.equal(r.result.successfulRoutes,0);assert.equal(r.search.expanded,1);assert.equal(r.search.exhausted,true);assert.ok(r.refinement.sameClassifications);assert.ok(r.refinement.maxEventShiftSeconds<.05);
 assert.ok(r.dateChecks.every(c=>c.firstMoveRuledOutWithinCatalog));assert.ok(r.perturbations.every(p=>p.firstMoveRuledOutWithinCatalog));
 const audit=firstFlightEnvelopeAudit(world,start.state,settings.refinedSolar);assert.equal(audit.firstMoveRuledOutWithinCatalog,true);assert.equal(aircraftMetrics(data.profile).cruiseKmPerHour,870.44);
});

test('research CLI verifies in two timezones; blocked route and invalid arguments have distinct exit statuses',()=>{
 const dir=mkdtempSync(tmpdir()+'/mission-research-');
 try {
  const run=(args,tz)=>{
   const stdout=openSync(dir+'/stdout','w'),stderr=openSync(dir+'/stderr','w');let result;
   try{result=spawnSync(process.execPath,['scripts/mission-research.mjs',...args],{stdio:['ignore',stdout,stderr],env:{...process.env,TZ:tz}});}finally{closeSync(stdout);closeSync(stderr);}
   return {...result,stdout:readFileSync(dir+'/stdout','utf8'),stderr:readFileSync(dir+'/stderr','utf8')};
  };
  const utc=run(['--research','--verify'],'UTC'),other=run(['--research','--verify'],'Pacific/Auckland');assert.equal(utc.status,0,utc.stderr);assert.equal(other.status,0,other.stderr);assert.equal(utc.stdout,other.stdout);
  const path=dir+'/path.json';writeFileSync(path,'["EGLL"]');const blocked=run(['--path',path],'UTC');assert.equal(blocked.status,2);assert.equal(JSON.parse(blocked.stdout).outcome,'blocked');
  const bad=run(['--research','--oops'],'UTC');assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.match(JSON.parse(bad.stderr).error,/Invalid research arguments/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
