// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {MissionSession,MISSION_MODEL} from '../dist/core/mission.js';
import {routePhasePosition} from '../dist/core/route.js';
import {saveChecksum} from '../dist/core/serialization.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
import {loadDepartureReport} from '../scripts/research-departure-fuel.mjs';
const definition=await loadCycleDefinition(),reference=await loadDepartureReport();
function polar() {
 const d=structuredClone(definition);d.scenarioId='synthetic-polar-cycle-test';d.worldVersion='synthetic-polar-v1';d.profile.assumptions.zeroFuelKg=60000;
 d.airports=['A','B','C'].map((id,i)=>({id,latitudeDeg:-80,longitudeDeg:i*90,suitability:{status:'screened-candidate'}}));d.targetId='C';
 d.initial={airportId:'A',utcMs:Date.parse('2026-06-21T00:00:00Z'),fuelKg:40000,stocks:{A:15000,B:5000,C:0}};return d;
}
function finish(session,path) {for(const id of path){const f=session.forecast(id);assert.equal(f.allowed,true,JSON.stringify(f.reasons));assert.deepEqual(session.fly(id),f);session.resume();}return session.current();}

test('all three verified western chains use the new cycle with identical physical results and public finite stocks',()=>{
 const expected=reference.routes;
 for(const r of expected) {
  const path=r.settings?.path??r.path,session=new MissionSession(definition),end=finish(session,path).state;
  assert.equal(end.status,'won');assert.equal(end.utcMs,r.final.utcMs);assert.equal(end.fuelKg,r.final.fuelKg);assert.equal(end.distanceKm,r.final.distanceKm);assert.equal(end.flights,3);
  assert.equal(end.mode,MISSION_MODEL.mode);assert.equal(end.stockVersion,'departure-stocks-v2');assert.equal(Object.keys(end.stocks).length,definition.airports.length);
  assert.ok(!/food|hunger/.test(JSON.stringify(end)));assert.equal(end.activeFlight,null);assert.equal(end.stocks.YPPH,r.stocks.YPPH);assert.equal(end.stocks.FACT,64000);
  const saved=session.save();assert.equal(session.fly('NZCH').allowed,false);assert.equal(session.save(),saved);
 }
});

test('selection/blocked launches never change UTC, fuel, stocks, journal or save; indeterminate is distinct from Sun',()=>{
 const session=new MissionSession(definition),before=session.save();
 assert.equal(session.forecast('NZCH').allowed,true);assert.equal(session.forecast('FACT').forecast.solar.status,'unsafe');
 for(const id of ['FACT','ENSB','SCEL','missing'])assert.equal(session.fly(id).allowed,false);
 assert.equal(session.save(),before);assert.equal(session.currentTimeUtc,definition.initial.utcMs);
 const uncertain=new MissionSession(definition,{maxEvaluations:4}),u=uncertain.save(),f=uncertain.fly('NZCH');
 assert.equal(f.allowed,false);assert.ok(f.reasons.includes('solar_indeterminate'));assert.equal(f.forecast.solar.status,'indeterminate');assert.equal(uncertain.save(),u);
 assert.equal(new MissionSession(polar(),{maxEvaluations:4}).availability().status,'unresolved');
});

test('accepted plan is isolated from caller mutation, with continuous departure/cruise state and read-only future preview',()=>{
 const d=structuredClone(definition),session=new MissionSession(d),choice=session.fly('NZCH'),f=structuredClone(choice.forecast),original=session.save();
 d.initial.stocks.NZCH=0;choice.forecast.next.stocks.NZCH=999999;session.definition.initial.fuelKg=0;
 assert.equal(session.save(),original);const departure=f.phases.find(p=>p.label==='departure').route,takeoff=session.stateAt((departure.startUtcMs+departure.endUtcMs)/2).state;
 assert.equal(takeoff.phase,'departure');assert.ok(Math.abs(takeoff.fuelKg-(f.refuelling.fuelKg-900))<1e-8);assert.equal(takeoff.distanceKm,0);
 const cruise=f.phases.find(p=>p.label==='cruise').route,t=(cruise.startUtcMs+cruise.endUtcMs)/2,view=session.stateAt(t).state;
 assert.equal(view.phase,'cruise');assert.equal(view.airportId,null);assert.deepEqual(view.position,routePhasePosition(cruise,t));
 // Fractional UTC midpoints round at sub-millisecond precision; tolerate less than a milligram.
 assert.ok(Math.abs(view.fuelKg-(f.refuelling.fuelKg-1800-f.distanceKm*6.5/2))<1e-6);assert.ok(Math.abs(view.distanceKm-f.distanceKm/2)<1e-7);
 assert.equal(session.save(),original);session.stopAt(t);assert.equal(session.fly('YPPH').reasons[0],'mission_busy');
 assert.throws(()=>session.stopAt(t-1),/rewind/);assert.throws(()=>session.stateAt(definition.initial.utcMs-1),/precedes/);
 const restored=MissionSession.restore(session.save(),definition);assert.deepEqual(restored.current(),session.current());assert.deepEqual(restored.resume(),session.resume());
});

test('refuelling setup transfers nothing; pumping debits exactly once across pause/save/restore and event delivery',()=>{
 const session=new MissionSession(definition),f=session.fly('NZCH').forecast,refuel=f.phases.find(p=>p.label==='refuelling').route;
 const setup=session.stateAt(refuel.startUtcMs+150000).state;assert.equal(setup.fuelKg,definition.initial.fuelKg);assert.equal(setup.stocks.SCEL,100000);
 const halfway=refuel.startUtcMs+300000+1200000,paused=session.stopAt(halfway);
 assert.equal(paused.state.phase,'refuelling');assert.equal(paused.state.stocks.SCEL,84000);assert.equal(paused.state.fuelKg,46000);assert.equal(paused.state.airportId,"SCEL");assert.equal(paused.state.flights,0);
 assert.equal(paused.events.filter(e=>e.kind==='arrived').length,0);assert.deepEqual(session.stopAt(halfway).newEvents,[]);
 const restored=MissionSession.restore(session.save(),definition);assert.deepEqual(restored.current(),session.current());assert.deepEqual(restored.resume(),session.resume());
 assert.equal(restored.current().state.stocks.NZCH,64000);assert.equal(restored.current().state.stocks.SCEL,f.refuelling.stockKg);assert.equal(restored.current().state.fuelKg,f.next.fuelKg);assert.deepEqual(restored.resume().newEvents,[]);
 assert.deepEqual(restored.current().events.map(e=>e.sequence),restored.current().events.map((_,i)=>i));
});

test('intermediate target landing waits for the complete safe turnaround before winning',()=>{
 const d=structuredClone(definition);d.targetId='NZCH';const session=new MissionSession(d),f=session.fly('NZCH').forecast;
 assert.equal(session.stopAt(f.arrivalUtcMs).state.status,'running');assert.equal(session.current().state.phase,'service');
 assert.equal(session.stopAt(f.endUtcMs-1).state.status,'running');assert.equal(session.resume().state.status,'won');
 assert.equal(session.current().events.filter(e=>e.kind==='mission_won').length,1);

});

test('revisits use only needed source fuel and never refill the destination warehouse',()=>{
 const d=polar();d.initial.fuelKg=5000;d.initial.stocks={A:50000,B:50000,C:0};const session=new MissionSession(d);
 const first=session.fly('B').forecast;session.resume();assert.equal(session.current().state.stocks.B,50000);assert.equal(session.current().state.stocks.A,first.refuelling.stockKg);
 const second=session.fly('A').forecast;session.resume();assert.equal(session.current().state.stocks.A,first.refuelling.stockKg);assert.equal(session.current().state.stocks.B,second.refuelling.stockKg);
 const third=session.fly('B').forecast;session.resume();assert.equal(session.current().state.stocks.A,first.refuelling.stockKg-third.refuelling.transferKg);
});

test('planning dead ends freeze time without death; an initially sunlit state is a genuine terminal Sun event',()=>{
 const d=polar();d.initial.fuelKg=1;d.initial.stocks.A=0;const session=new MissionSession(d),saved=session.save(),availability=session.availability();
 assert.equal(availability.status,'no_safe_choices');assert.equal(session.save(),saved);assert.equal(session.current().state.status,'running');assert.equal(session.current().state.death,null);
 assert.equal(new MissionSession(d,{maxEvaluations:4}).availability().status,'no_safe_choices');
 session.stopAt(d.initial.utcMs+86400000);assert.equal(session.currentTimeUtc,d.initial.utcMs);
 const sun=structuredClone(definition);sun.initial.utcMs=Date.parse('2026-06-21T16:00:00Z');const dead=new MissionSession(sun);
 assert.equal(dead.current().state.status,'dead');assert.equal(dead.fly('NZCH').allowed,false);assert.equal(dead.current().events.at(-1).kind,'mission_died');assert.deepEqual(MissionSession.restore(dead.save()).current(),dead.current());
});

test('save versions, definitions, cursor and snapshot are checked; old/malformed saves never replace a live session',()=>{
 const session=new MissionSession(definition);session.fly('NZCH');session.stopAt(definition.initial.utcMs+3600000);const saved=session.save();
 const mutate=change=>{const v=JSON.parse(saved);change(v.payload);v.checksum=saveChecksum(v.payload);return JSON.stringify(v);};
 assert.throws(()=>MissionSession.restore('{'));assert.throws(()=>MissionSession.restore('{"format":"survival","version":1}'));
 assert.throws(()=>MissionSession.restore(mutate(p=>p.mode='survival')),/Incompatible/);
 assert.throws(()=>MissionSession.restore(mutate(p=>p.eventVersion=1)),/Incompatible/);
 assert.throws(()=>MissionSession.restore(mutate(p=>p.cursorUtcMs=p.definition.initial.utcMs-1)),/cursor/);
 assert.throws(()=>MissionSession.restore(mutate(p=>p.snapshot.state.fuelKg+=1)),/snapshot/);
 const wrong=structuredClone(definition);wrong.stockVersion='other';assert.throws(()=>MissionSession.restore(saved,wrong),/definition differs/);
 assert.equal(session.save(),saved);assert.deepEqual(MissionSession.restore(saved,definition).current(),session.current());
 const duplicate=structuredClone(definition);duplicate.airports.push(duplicate.airports[0]);assert.throws(()=>new MissionSession(duplicate),/airport/);
});

test('cycle CLI replays in two timezones, rejects direct flight, and resumes a partially pumped save',()=>{
 const dir=mkdtempSync(tmpdir()+'/mission-cycle-');
 try {
  const run=(args,tz='UTC')=>{const out=openSync(dir+'/out','w'),err=openSync(dir+'/err','w');let r;
   try{r=spawnSync(process.execPath,['scripts/mission-cycle-cli.mjs',...args],{stdio:['ignore',out,err],env:{...process.env,TZ:tz}});}finally{closeSync(out);closeSync(err);}
   return {status:r.status,out:readFileSync(dir+'/out','utf8'),err:readFileSync(dir+'/err','utf8')};};
  const args=['--path','examples/mission-cycle/christchurch.json'],a=run(args),b=run(args,'Pacific/Auckland');assert.equal(a.status,0,a.err);assert.equal(a.out,b.out);assert.equal(JSON.parse(a.out).state.status,'won');
  const bad=run(['--path','examples/mission-cycle/direct-blocked.json']);assert.equal(bad.status,2);assert.deepEqual(JSON.parse(bad.out).blocked.reasons,['sun']);
  const path=dir+'/save.json',paused=run([...args,'--stop-at','2026-06-21T22:20:00Z','--save',path]);assert.equal(paused.status,0,paused.err);assert.equal(JSON.parse(paused.out).state.phase,'refuelling');
  writeFileSync(dir+'/tail.json','["YPPH","FACT"]');const resumed=run(['--load',path,'--resume','--path',dir+'/tail.json']);assert.equal(resumed.status,0,resumed.err);assert.equal(resumed.out,a.out);
  const invalid=run(['--unknown']);assert.equal(invalid.status,1);assert.equal(invalid.out,'');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
