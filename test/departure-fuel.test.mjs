// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {MissionSession} from '../dist/core/mission.js';
import {aircraftLeg,aircraftMetrics} from '../dist/core/aircraft.js';
import {searchStationarySunrise} from '../dist/core/waiting.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
const definition=await loadCycleDefinition();
function polar(){const d=structuredClone(definition);d.profile.assumptions.zeroFuelKg=60000;d.airports=['A','B','C'].map((id,i)=>({id,latitudeDeg:-80,longitudeDeg:i*40,suitability:{status:'screened-candidate'}}));d.targetId='C';d.initial={airportId:'A',utcMs:Date.parse('2026-06-21T00:00:00Z'),fuelKg:5000,stocks:{A:100000,B:100000,C:100000}};return d;}
test('long flight leaves nearby destinations usable; forecasts load only what the selected route needs',()=>{
 const s=new MissionSession(definition);s.fly('NZCH');s.resume();const before=s.save(),near=s.forecast('NZAA').forecast,far=s.forecast('YPPH').forecast;
 assert.equal(near.allowed,true,JSON.stringify(near.reasons));assert.ok(near.refuelling.transferKg<far.refuelling.transferKg);assert.equal(s.save(),before);
 assert.ok(aircraftLeg(definition.profile,near.distanceKm,aircraftMetrics(definition.profile).fuelCapacityKg).reasons.includes('landing_mass'));
 assert.ok(near.phases.findIndex(p=>p.label==='refuelling')<near.phases.findIndex(p=>p.label==='departure'));
 assert.equal(near.phases.at(-1).label,'service');assert.equal(near.next.stocks.NZAA,64000);assert.ok(Math.abs(near.next.fuelKg-5000)<1e-8);
});
test('enough existing fuel skips pumping and setup, empty source stock does not forbid departure',()=>{
 const d=polar();d.initial.fuelKg=30000;d.initial.stocks.A=0;const s=new MissionSession(d),f=s.fly('B').forecast;
 assert.equal(f.allowed,true,JSON.stringify(f.reasons));assert.equal(f.refuelling.transferKg,0);assert.equal(f.refuelling.durationSeconds,0);assert.equal(f.refuelling.fuelKg,30000);
 assert.equal(f.departureUtcMs,d.initial.utcMs);assert.equal(f.phases[0].label,'departure');s.resume();assert.equal(s.current().state.stocks.A,0);
});
test('stock shortage and excessive landing mass reject without partial fuel transfer or fuel dumping',()=>{
 const d=polar();d.initial.stocks.A=1;let s=new MissionSession(d),before=s.save(),f=s.fly('B');assert.equal(f.allowed,false);assert.ok(f.reasons.includes('fuel_stock'));assert.equal(s.save(),before);
 const heavy=structuredClone(definition);heavy.initial.fuelKg=aircraftMetrics(heavy.profile).fuelCapacityKg;s=new MissionSession(heavy);before=s.save();f=s.fly('SCIE');
 assert.ok(f.reasons.includes('landing_mass'),JSON.stringify(f.reasons));assert.equal(f.forecast.refuelling.transferKg,0);assert.equal(f.forecast.refuelling.fuelKg,heavy.initial.fuelKg);assert.equal(s.save(),before);
});
test('route requiring more than tank capacity cannot draw a partial load',()=>{
 const d=structuredClone(definition);d.profile.assumptions.cruiseBurnKgPerKm=15;const s=new MissionSession(d),before=s.save(),f=s.fly('NZCH');assert.equal(f.allowed,false);assert.ok(f.reasons.includes('fuel_capacity'));assert.equal(s.save(),before);
});
test('sunrise during source refuelling forbids the whole transition without changing the session',()=>{
 const d=structuredClone(definition),from=d.airports.find(a=>a.id==='SCEL'),sun=searchStationarySunrise(from,d.initial.utcMs);assert.equal(sun.status,'found');
 d.initial.utcMs=sun.eventUtcMs-120000;d.initial.fuelKg=5000;const s=new MissionSession(d),before=s.save(),f=s.fly('NZCH');
 assert.equal(f.allowed,false);assert.equal(f.forecast.solar.status,'unsafe');assert.equal(f.forecast.solar.phase,'refuelling');assert.ok(f.reasons.includes('sun'));assert.equal(s.save(),before);
});
test('service fuel is included before departure and reserve survives the whole arrival service',()=>{
 const d=polar();d.profile.assumptions.serviceBurnKgPerSecond=.5;const s=new MissionSession(d),f=s.fly('B').forecast;
 assert.equal(f.allowed,true,JSON.stringify(f.reasons));assert.equal(f.refuelling.requiredFuelKg,f.flight.burnKg+5000+300);assert.ok(Math.abs(f.next.fuelKg-5000)<1e-8);
 s.resume();assert.deepEqual(s.current().events.map(e=>e.kind),['mission_started','flight_committed','refuelling_started','flight_started','arrived','flight_completed']);
 const old=JSON.parse(s.save());old.version=1;assert.throws(()=>MissionSession.restore(JSON.stringify(old)),/Unsupported/);
});
