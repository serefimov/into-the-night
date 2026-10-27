// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,openSync,closeSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {SOLAR_MODEL} from '../dist/core/config.js';
import {MissionSession,MISSION_MODEL} from '../dist/core/mission.js';
import {MissionAvailabilityScan,availabilityReason} from '../dist/core/mission-availability.js';
import {saveChecksum} from '../dist/core/serialization.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
import {FlightController} from '../web/flight/controller.mjs';
import {FlightPlanningScan} from '../web/flight/planning-scan.mjs';
const real=await loadCycleDefinition();
function polar({empty=false,sun=false}={}){const d=structuredClone(real);d.scenarioId='synthetic-outcome';d.worldVersion='synthetic-outcome-world-v1';d.profile.id='synthetic-outcome-profile';d.seed='outcome-42-test';d.profile.assumptions.zeroFuelKg=60000;
 d.airports=['A','B','C','D'].map((id,i)=>({id,name:id,latitudeDeg:sun?80:-80,longitudeDeg:i===3?90:i*90,suitability:{status:i>=2?'unverified':'screened-candidate'}}));d.targetId='C';d.initial={airportId:'A',utcMs:Date.parse('2026-06-21T00:00:00Z'),fuelKg:empty?1:5000,stocks:{A:empty?0:50000,B:50000,C:0,D:0}};return d;}
const pause=()=>new Promise(r=>setTimeout(r,2));
async function until(check){for(let i=0;i<200;i++){if(check())return;await pause();}assert.fail('Planning scan did not settle');}
class FakeWorker{constructor(){this.requests=[];this.stopped=false;}postMessage(data){this.requests.push(data);}terminate(){this.stopped=true;}emit(data){this.onmessage({data});}}
function fakeScan(d=polar()){const c=new FlightController(d),workers=[],p=new FlightPlanningScan(c,()=>{},{workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;}});p.update();return {c,p,workers};}

test('partial catalog, duplicates and stale keys cannot establish a dead end; unknown reasons stay unresolved',()=>{
 const scan=new MissionAvailabilityScan('now',['B','C','D']);assert.equal(scan.accept('old',[{id:'B',allowed:true,reasons:[]}],true),false);assert.equal(scan.summary().checked,0);
 scan.accept('now',[{id:'B',allowed:false,reasons:['sun']}]);assert.equal(scan.summary().status,'checking');assert.equal(scan.summary().remaining,2);
 assert.throws(()=>scan.accept('now',[],true),/Incomplete/);assert.equal(scan.summary().complete,false);
 assert.throws(()=>scan.accept('now',[{id:'A',allowed:false,reasons:['sun']}]),/Invalid/);
 scan.accept('now',[{id:'B',allowed:false,reasons:['sun']},{id:'C',allowed:false,reasons:['solar_indeterminate']},{id:'D',allowed:false,reasons:['future_unknown_reason']}],true);
 assert.equal(scan.summary().checked,3);assert.equal(scan.summary().status,'unresolved');assert.equal(scan.summary().unresolvedIds.length,2);
 assert.throws(()=>scan.accept('now',[{id:'B',allowed:true,reasons:[]}]),/Conflicting/);
 assert.equal(availabilityReason({allowed:false,reasons:['fuel_stock','solar_indeterminate']}),'fuel');assert.equal(availabilityReason({allowed:false,reasons:['mission_busy']}),'unresolved');
});
test('complete session analysis is pure; only verified no-routes resolution commits a separate persistent terminal event',()=>{
 const s=new MissionSession(polar({empty:true})),before=s.current(),saved=s.save(),report=s.availability();assert.equal(report.status,'no_safe_choices');assert.equal(report.total,3);assert.equal(report.checked,3);assert.equal(s.save(),saved);
 const result=s.resolvePlanning();assert.equal(result.state.status,'lost');assert.equal(result.state.result.kind,'no_routes');assert.equal(result.state.death,null);assert.equal(result.state.phase,'lost');
 assert.equal(result.state.utcMs,before.state.utcMs);assert.equal(result.state.fuelKg,before.state.fuelKg);assert.deepEqual(result.state.stocks,before.state.stocks);assert.equal(result.events.at(-1).kind,'mission_lost');assert.equal(result.state.result.reasons.airport,2);assert.equal(result.state.result.reasons.fuel,1);
 assert.equal(s.fly('B').reasons[0],'mission_lost');assert.deepEqual(s.resolvePlanning().newEvents,[]);const lost=s.save(),restored=MissionSession.restore(lost);
 assert.deepEqual(restored.current(),s.current());assert.deepEqual(restored.resume().newEvents,[]);assert.deepEqual(restored.resolvePlanning().newEvents,[]);assert.equal(restored.current().events.filter(e=>e.kind==='mission_lost').length,1);assert.equal(JSON.parse(lost).version,3);assert.equal(MISSION_MODEL.eventVersion,3);
});
test('sun death, goal, operation pause and uncertainty remain distinct; planning resolution does not consume events without a result',()=>{
 const uncertain=new MissionSession(polar(),{maxEvaluations:4}),saved=uncertain.save();assert.equal(uncertain.resolvePlanning().availability.status,'unresolved');assert.equal(uncertain.save(),saved);assert.equal(uncertain.current().state.result,null);
 const edge=polar();edge.initial.utcMs=SOLAR_MODEL.endUtcMsExclusive-60000;edge.airports.forEach(a=>a.latitudeDeg=80);const failed=new MissionSession(edge),unchanged=failed.save();assert.equal(failed.resolvePlanning().availability.status,'failed');assert.equal(failed.save(),unchanged);assert.equal(failed.current().state.result,null);
 const heavy=polar();heavy.profile.assumptions.zeroFuelKg=126000;heavy.initial.fuelKg=100000;const mass=new MissionSession(heavy);assert.equal(mass.resolvePlanning().state.result.reasons.mass,1);
 const sun=new MissionSession(polar({sun:true}));assert.equal(sun.resolvePlanning().state.result.kind,'sun');assert.equal(sun.current().state.status,'dead');assert.equal(sun.current().events.at(-1).kind,'mission_died');
 const d=polar();d.targetId='B';const won=new MissionSession(d);const f=won.fly('B');assert.equal(f.allowed,true);const mid=f.forecast.phases[0].route.startUtcMs+1000;won.stopAt(mid);const busy=won.save();assert.equal(won.resolvePlanning().availability.status,'busy');assert.equal(won.save(),busy);
 won.resume();assert.equal(won.resolvePlanning().state.result.kind,'goal');assert.equal(won.current().state.status,'won');assert.equal(won.current().events.filter(e=>e.kind==='mission_lost').length,0);
});
test('forged outcomes and v2 saves are rejected without replacing an existing party; keys include stocks, UTC and scenario',()=>{
 const s=new MissionSession(polar()),saved=s.save(),v=JSON.parse(saved);v.version=2;assert.throws(()=>MissionSession.restore(JSON.stringify(v)),/Unsupported/);
 const corrupt=change=>{const v=JSON.parse(saved);change(v.payload);v.checksum=saveChecksum(v.payload);return JSON.stringify(v);};
 assert.throws(()=>MissionSession.restore(corrupt(p=>p.noRoutesAt=p.cursorUtcMs)),/not confirmed/);
 const d=polar();d.initial.stocks.A-=1;assert.notEqual(new MissionSession(d).planningKey,s.planningKey);d.initial.utcMs+=1000;assert.notEqual(new MissionSession(d).planningKey,s.planningKey);d.scenarioId='different';assert.notEqual(new MissionSession(d).planningKey,s.planningKey);assert.equal(s.save(),saved);
 const lost=new MissionSession(polar({empty:true}));lost.resolvePlanning();const x=JSON.parse(lost.save());x.payload.snapshot.state.result.total++;x.checksum=saveChecksum(x.payload);assert.throws(()=>MissionSession.restore(JSON.stringify(x)),/snapshot/);
});
test('a real late arrival can lose without sunlight death; the committed event exists only at the final planning UTC',()=>{
 const d=structuredClone(real);d.targetId='RJTT';const s=new MissionSession(d);for(const id of ['BIKF','CYEG','UHSS','UNNT']){assert.equal(s.fly(id).allowed,true,id);s.resume();}
 const end=s.current().state;assert.equal(end.phase,'planning');assert.equal(end.status,'running');const result=s.resolvePlanning();assert.equal(result.state.status,'lost');assert.equal(result.state.death,null);assert.equal(result.state.result.total,1182);
 const earlier=s.stateAt(end.utcMs-1);assert.equal(earlier.state.status,'running');assert.equal(earlier.state.result,null);assert.ok(earlier.events.every(e=>e.kind!=='mission_lost'));
 assert.deepEqual(MissionSession.restore(s.save()).current(),s.current());
});
test('worker partial and uncertain replies never lose; stale replies after a flight/restart cannot overwrite a new scan',()=>{
 const {c,p,workers}=fakeScan(),w=workers[0],request=w.requests[0];w.emit({...request,batch:[{id:'B',allowed:false,reasons:['solar_indeterminate']}],done:false});assert.equal(p.summary().checked,1);assert.equal(c.view.state.status,'running');
 w.emit({...request,batch:[{id:'C',allowed:false,reasons:['unverified_airport']},{id:'D',allowed:false,reasons:['unverified_airport']}],done:true});assert.equal(p.summary().status,'unresolved');assert.equal(c.view.state.result,null);
 c.select('B');assert.equal(c.fly(0),true);c.pause(1);p.update();assert.equal(p.summary().status,'busy');w.emit({...request,batch:[],done:true});assert.equal(c.view.state.status,'running');
 p.reset();c.restart();p.update();const current=p.summary();w.emit({...request,batch:[],done:true});assert.deepEqual(p.summary(),current);assert.equal(c.view.state.flights,0);assert.equal(c.tracks.length,0);p.destroy();
});
test('one safe hidden destination keeps the party running; forged all-blocked transport is rechecked by the core and worker errors fall back',async()=>{
 const {c,p,workers}=fakeScan(),w=workers[0],request=w.requests[0];
 w.emit({...request,batch:['B','C','D'].map(id=>({id,allowed:false,reasons:['sun']})),done:true});
 await until(()=>p.summary().complete);assert.equal(c.view.state.status,'running');assert.deepEqual(p.summary().availableIds,['B']);assert.equal(p.summary().total,3);p.destroy();
 const f=fakeScan();f.workers[0].onerror();await until(()=>f.p.summary().complete);assert.deepEqual(f.p.summary().availableIds,['B']);assert.equal(f.c.view.state.result,null);f.p.destroy();
});
test('matching completed no-routes transport commits once; a restart creates a fresh journal and cancels old replies',()=>{
 const {c,p,workers}=fakeScan(polar({empty:true})),w=workers[0],request=w.requests[0];
 const batch=['B','C','D'].map(id=>({id,allowed:false,reasons:['fuel_stock']}));w.emit({...request,batch,done:true});assert.equal(c.view.state.status,'lost');assert.equal(c.view.events.filter(e=>e.kind==='mission_lost').length,1);
 w.emit({...request,batch,done:true});assert.equal(c.view.events.filter(e=>e.kind==='mission_lost').length,1);
 p.reset();c.restart();p.update();assert.equal(c.view.state.status,'running');assert.equal(c.view.state.result,null);assert.equal(c.view.events.length,1);w.emit({...request,batch,done:true});assert.equal(c.view.state.status,'running');p.destroy();
});
test('CLI records/restores no-routes with exit 3 and preserves an unresolved party as running',()=>{
 const dir=mkdtempSync(tmpdir()+'/outcome-cli-');try{
  const lost=new MissionSession(polar({empty:true}));writeFileSync(dir+'/input',lost.save());
  const run=args=>{const out=openSync(dir+'/out','w'),err=openSync(dir+'/err','w');let r;try{r=spawnSync(process.execPath,['scripts/mission-cycle-cli.mjs',...args],{stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}return {status:r.status,out:readFileSync(dir+'/out','utf8'),err:readFileSync(dir+'/err','utf8')};};
  const a=run(['--load',dir+'/input','--save',dir+'/lost']);assert.equal(a.status,3,a.err);assert.equal(JSON.parse(a.out).state.result.kind,'no_routes');const b=run(['--load',dir+'/lost']);assert.equal(b.status,3,b.err);assert.equal(a.out,b.out);
  writeFileSync(dir+'/uncertain',new MissionSession(polar(),{maxEvaluations:4}).save());const u=run(['--load',dir+'/uncertain']);assert.equal(u.status,0,u.err);assert.equal(JSON.parse(u.out).state.status,'running');assert.equal(JSON.parse(u.out).availability.status,'unresolved');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
