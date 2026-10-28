// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {saveChecksum} from '../dist/core/serialization.js';
import {MissionSession} from '../dist/core/mission.js';
import {DEPARTURE_SEARCH} from '../dist/core/departure-window.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
import {FlightController} from '../web/flight/controller.mjs';
const definition=await loadCycleDefinition();

test('real KMCI solar rejection becomes a certified window without advancing the session',()=>{
 const s=new MissionSession(definition),before=s.save(),now=s.currentTimeUtc;
 assert.equal(s.forecast('KMCI').allowed,false);
 const window=s.departureWindow('KMCI');
 assert.equal(window.status,'waiting');assert.equal(window.startUtcMs,now+15*60000);
 assert.equal(window.forecast.allowed,true);assert.equal(window.stepSeconds,900);
 assert.ok(window.forecast.departureUtcMs>=window.startUtcMs);
 assert.equal(s.save(),before);assert.ok(window.evaluations<=DEPARTURE_SEARCH.defaultMaxEvaluations);
 assert.equal(s.waitForDeparture('KMCI',window.startUtcMs),true);
 s.stopAt(now+5*60000);
 const altered=JSON.parse(s.save());altered.payload.choices[0].destinationId='UNNT';
 altered.checksum=saveChecksum(altered.payload);
 assert.throws(()=>MissionSession.restore(JSON.stringify(altered)),/blocked/);
 const c=new FlightController(definition);c.restore(s.save());
 assert.equal(c.selectedId,'KMCI');assert.equal(c.playing,false);assert.equal(JSON.parse(s.save()).version,5);
 c.advanceTo(c.session.endUtcMs,0);
 assert.equal(c.view.state.phase,'planning');assert.equal(c.view.state.flights,0);
 assert.equal(c.choice.allowed,true);assert.equal(c.view.state.fuelKg,definition.initial.fuelKg);
 assert.deepEqual(c.view.state.stocks,definition.initial.stocks);
 assert.equal(c.fly(0),true);
 const pumping=c.activeForecast.phases.find(p=>p.label==='refuelling').route;
 c.advanceTo((pumping.startUtcMs+pumping.endUtcMs)/2,0);
 assert.ok(c.view.state.stocks.ULLI<definition.initial.stocks.ULLI);
 assert.ok(c.view.state.stocks.ULLI>window.forecast.refuelling.stockKg);
 const during=c.session.current();c.restore(c.session.save());assert.deepEqual(c.session.current(),during);
 c.advanceTo(c.session.endUtcMs,0);
 assert.equal(c.view.state.stocks.ULLI,window.forecast.refuelling.stockKg);
 assert.equal(c.view.state.airportId,'KMCI');assert.equal(c.view.state.flights,1);
 assert.deepEqual(MissionSession.restore(c.session.save()).current(),c.session.current());
});

test('permanent, immediate, budget and finite-search outcomes are distinct',()=>{
 const s=new MissionSession(definition);
 assert.equal(s.departureWindow('BIKF').status,'now');
 assert.equal(s.departureWindow('ULLI').status,'blocked');
 const poor=structuredClone(definition);poor.initial.fuelKg=0;poor.initial.stocks.ULLI=0;
 assert.equal(new MissionSession(poor).departureWindow('KMCI').status,'blocked');
 assert.equal(new MissionSession(definition,{maxEvaluations:4}).departureWindow('KMCI').status,'indeterminate');
 const noWindow=s.departureWindow('UNNT');assert.equal(noWindow.status,'not_found');assert.equal(noWindow.limit,'sunrise');assert.equal(noWindow.startUtcMs,null);
 s.fly('BIKF');assert.equal(s.departureWindow('KMCI').status,'blocked');
});

test('unsafe standing cannot be skipped and targeted wait cancellation survives replay',()=>{
 const s=new MissionSession(definition),before=s.save();
 assert.equal(s.waitForDeparture('KMCI',s.currentTimeUtc+86400000),false);assert.equal(s.save(),before);
 const window=s.departureWindow('KMCI');s.waitForDeparture('KMCI',window.startUtcMs);
 s.stopAt(s.currentTimeUtc+60000);s.cancelWait();
 const restored=MissionSession.restore(s.save());
 assert.deepEqual(restored.current(),s.current());assert.equal(restored.waitingDestinationId,'KMCI');
});

test('bounded horizon is not a permanent block, and waiting avoids an immediate no-routes loss',()=>{
 const d=structuredClone(definition);
 d.scenarioId='synthetic-window-horizon';d.profile.assumptions.zeroFuelKg=60000;d.profile.assumptions.cruiseBurnKgPerKm=1;
 d.airports=[{id:'A',latitudeDeg:-80,longitudeDeg:0,suitability:{status:'screened-candidate'}},{id:'B',latitudeDeg:80,longitudeDeg:0,suitability:{status:'screened-candidate'}}];
 d.targetId='B';d.initial={airportId:'A',utcMs:Date.parse('2026-06-21T00:00:00Z'),fuelKg:40000,stocks:{A:0,B:0}};
 const horizon=new MissionSession(d).departureWindow('B');
 assert.equal(horizon.status,'not_found');assert.equal(horizon.limit,'horizon');assert.equal(horizon.checked,96);
 const heavy=structuredClone(d);heavy.profile.assumptions.zeroFuelKg=126000;heavy.initial.fuelKg=100000;
 const mass=new MissionSession(heavy);assert.ok(mass.forecast('B').reasons.includes('landing_mass'));
 assert.equal(mass.departureWindow('B').status,'blocked');
 const pair=structuredClone(definition);pair.airports=pair.airports.filter(a=>['ULLI','KMCI'].includes(a.id));pair.targetId='KMCI';pair.initial.stocks={ULLI:64000,KMCI:64000};
 const session=new MissionSession(pair);
 assert.equal(session.resolvePlanning().state.status,'running');assert.equal(session.availability().status,'no_safe_choices');
 assert.equal(session.departureWindow('KMCI').status,'waiting');
});

test('stale window transport cannot change statuses after waiting starts',async()=>{
 const {FlightPlanningScan}=await import('../web/flight/planning-scan.mjs');
 let worker;
 const c=new FlightController(definition),p=new FlightPlanningScan(c,()=>{},{workerFactory:()=>worker={postMessage(){},terminate(){}}});
 p.update();const key=p.key,generation=p.generation;
 worker.onmessage({data:{key,generation,batch:[{id:'KMCI',allowed:false,reasons:['sun']}],done:false}});
 const window=c.session.departureWindow('KMCI');
 worker.onmessage({data:{key,generation,windowBatch:[{id:'KMCI',window}],windowsChecked:1,windowsTotal:1182,windowsDone:false}});
 assert.equal(p.statuses.get('KMCI').window.status,'waiting');
 const old=worker;c.select('KMCI');c.waitForDeparture(window.startUtcMs,0);c.pause(0);p.update();
 old.onmessage({data:{key,generation,windowBatch:[{id:'KMCI',window}],windowsChecked:99,windowsTotal:1182,windowsDone:false}});
 assert.equal(p.statuses.size,0);assert.equal(p.windowsChecked,0);p.destroy();
});

test('the first confirmed grid point follows rejected earlier points and respects the model range',()=>{
 const d=structuredClone(definition);d.scenarioId='synthetic-grid-order';
 d.profile.assumptions.zeroFuelKg=60000;d.profile.assumptions.cruiseBurnKgPerKm=1;
 d.airports=[{id:'A',latitudeDeg:-80,longitudeDeg:0,suitability:{status:'screened-candidate'}},{id:'B',latitudeDeg:-40,longitudeDeg:90,suitability:{status:'screened-candidate'}}];
 d.targetId='B';d.initial={airportId:'A',utcMs:Date.parse('2026-06-21T00:00:00Z'),fuelKg:40000,stocks:{A:0,B:0}};
 const s=new MissionSession(d),window=s.departureWindow('B');
 assert.equal(window.status,'waiting');assert.equal(window.checked,22);
 assert.equal(window.startUtcMs,d.initial.utcMs+22*900000);
 for(let i=1;i<22;i++){
  const earlier=new MissionSession(d);assert.equal(earlier.waitUntil(d.initial.utcMs+i*900000).status,'safe');earlier.resume();
  assert.equal(earlier.forecast('B').allowed,false);
 }
 d.initial.utcMs=Date.parse('2040-12-31T23:59:00Z');d.airports[0].latitudeDeg=80;d.airports[1].latitudeDeg=70;
 const limited=new MissionSession(d).departureWindow('B');
 assert.equal(limited.status,'not_found');assert.equal(limited.limit,'range');
});
