// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,openSync,closeSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {MissionSession} from '../dist/core/mission.js';
import {forecastMissionFlight} from '../dist/core/mission-flight.js';
import {solarExposure} from '../dist/core/solar.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
import {loadAcademicReport} from '../scripts/academic-westward-research.mjs';
const d=await loadCycleDefinition(),r=await loadAcademicReport();
test('default first airport stage is the recorded SPB to Novosibirsk western mission, with real unchanged profile and finite stocks',()=>{
 assert.equal(d.scenarioId,'academic-westward');assert.equal(d.initial.airportId,'ULLI');assert.equal(d.targetId,'UNNT');assert.equal(d.initial.utcMs,Date.parse('2026-08-01T20:00:00Z'));assert.equal(d.initial.fuelKg,30000);
 assert.equal(d.profile.id,'B788-reference-v1');assert.equal(d.airports.length,1183);assert.ok(Object.values(d.initial.stocks).every(kg=>kg===64000));assert.equal(d.targetCompletion,'after_service');
 assert.ok(solarExposure(d.airports.find(a=>a.id==='ULLI'),d.initial.utcMs).safe);assert.equal(r.report.shortcuts.safePaths.length,0);assert.equal(r.report.shortcuts.unresolved.length,0);
 for(const day of r.report.polarDays){assert.equal(day.svalbard.status,'safe');assert.equal(day.northPole.status,'safe');}
});
test('every recorded alternative replays through the session; seven distinct first choices complete a real western circuit',()=>{
 const first=new Set();assert.equal(r.routes.length,25);
 for(const route of r.routes){const s=new MissionSession(d);for(const id of route.path){const f=s.fly(id);assert.equal(f.allowed,true,JSON.stringify(f.reasons));s.resume();}
  const state=s.current().state;assert.equal(state.status,'won');assert.equal(state.utcMs,route.final.utcMs);assert.equal(state.fuelKg,route.final.fuelKg);assert.equal(state.distanceKm,route.final.distanceKm);assert.equal(state.flights,4);
  assert.ok(route.evidence.longitudeChangeDeg<-300);assert.equal(route.evidence.westwardAroundWorld,true);assert.equal(state.stocks.UNNT,64000);first.add(route.path[0]);
 }
 assert.deepEqual([...first],r.report.firstIds);assert.equal(first.size,7);
});
test('unsafe direct shortcut cannot mutate the session; first leg needs no refuelling and later departure uses only its source stock',()=>{
 const s=new MissionSession(d),before=s.save(),bad=s.fly('UNNT');assert.equal(bad.allowed,false);assert.ok(bad.reasons.includes('sun'));assert.equal(bad.forecast.solar.status,'unsafe');assert.equal(s.save(),before);
 const first=s.fly('BIKF').forecast;assert.equal(first.refuelling.transferKg,0);assert.equal(first.phases[0].label,'departure');s.resume();assert.equal(s.current().state.stocks.BIKF,64000);
 const second=s.fly('CYEG').forecast,refuel=second.phases.find(p=>p.label==='refuelling').route;s.stopAt(refuel.startUtcMs+1500000);assert.equal(s.current().state.airportId,'BIKF');assert.equal(s.current().state.stocks.BIKF,48000);assert.equal(s.current().state.stocks.CYEG,64000);
 const restored=MissionSession.restore(s.save(),d);assert.deepEqual(restored.resume(),s.resume());assert.equal(s.current().state.stocks.BIKF,second.refuelling.stockKg);
});
test('primary final state is inherited for continuation, without claiming that Japan or knowledge transfer is already solved',()=>{
 const s=new MissionSession(d);for(const id of r.witness.path){assert.equal(s.fly(id).allowed,true);s.resume();}const view=s.current().state;
 const state={airportId:'UNNT',utcMs:view.utcMs,fuelKg:view.fuelKg,stocks:view.stocks,flights:view.flights,distanceKm:view.distanceKm,won:false},world={...d,targetId:'RJTT'};
 assert.equal(r.continuation.knowledgeTransferSeconds,null);assert.ok(r.continuation.allowedIds.length>0);assert.equal(r.continuation.utcMs,view.utcMs);
 for(const id of r.continuation.allowedIds)assert.equal(forecastMissionFlight(world,state,id).allowed,true,id);
 assert.equal(forecastMissionFlight(world,state,'RJTT').allowed,false);assert.equal(view.stocks.UNNT,64000);
});
test('historical control definitions remain explicit; saves are not silently converted into the new scenario',async()=>{
 const old=await loadCycleDefinition('data/scenarios/westward-control-v2.json'),session=new MissionSession(old),saved=session.save();assert.equal(old.initial.airportId,'SCEL');assert.equal(MissionSession.restore(saved).current().state.airportId,'SCEL');assert.throws(()=>MissionSession.restore(saved,d),/definition differs/);
});
test('default CLI completes the first stage identically in two timezones and blocks the direct eastern flight',()=>{
 const dir=mkdtempSync(tmpdir()+'/academic-cli-');
 try{function run(path,tz='UTC'){const out=openSync(dir+'/out','w'),err=openSync(dir+'/err','w');let p;try{p=spawnSync(process.execPath,['scripts/mission-cycle-cli.mjs','--path',path],{env:{...process.env,TZ:tz},stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}return {status:p.status,out:readFileSync(dir+'/out','utf8'),err:readFileSync(dir+'/err','utf8')};}
  const a=run('examples/academic-westward/iceland.json'),b=run('examples/academic-westward/iceland.json','Asia/Novosibirsk');assert.equal(a.status,0,a.err);assert.equal(a.out,b.out);assert.equal(JSON.parse(a.out).state.status,'won');
  const bad=run('examples/academic-westward/direct-blocked.json');assert.equal(bad.status,2,bad.err);assert.equal(JSON.parse(bad.out).state.utcMs,d.initial.utcMs);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
