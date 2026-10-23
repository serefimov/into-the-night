// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aircraftMetrics,aircraftLeg,aircraftRefuelling,validateAircraftProfile} from '../src/core/aircraft.ts';
import {loadMissionData,generateFuel,validateCatalog} from '../scripts/mission-data.mjs';
const profile=JSON.parse(readFileSync('data/mission/aircraft.json','utf8'));
const data=await loadMissionData();

test('B788 reference uses source units and a physically plausible long-range envelope',()=>{
 const m=aircraftMetrics(profile);assert.equal(m.fuelCapacityKg,100964.8);assert.equal(m.cruiseKmPerHour,870.44);
 assert.ok(m.fullFuelRangeKm>14000&&m.fullFuelRangeKm<profile.facts.publishedRangeNm*1.852);
 assert.ok(profile.assumptions.zeroFuelKg+m.fuelCapacityKg<=profile.facts.maxTakeoffKg);
 const flight=aircraftLeg(profile,10000,m.fuelCapacityKg);assert.ok(flight.dispatchable);assert.ok(flight.durationSeconds>11*3600&&flight.durationSeconds<13*3600);
 assert.equal(flight.arrivalFuelKg+flight.burnKg,m.fuelCapacityKg);assert.ok(flight.landingMassKg<profile.facts.maxLandingKg);
});

test('automatic full fuel does not silently allow overweight short landings',()=>{
 const full=aircraftLeg(profile,3000,aircraftMetrics(profile).fuelCapacityKg);assert.equal(full.dispatchable,false);assert.deepEqual(full.reasons,['landing_mass']);
 const light=aircraftLeg(profile,3000,50000);assert.ok(light.dispatchable);
 const outOfRange=aircraftLeg(profile,16000,aircraftMetrics(profile).fuelCapacityKg);assert.ok(outOfRange.reasons.includes('fuel_or_reference_reserve'));
});

test('maximum refuelling conserves finite stocks and charges actual duration; zero transfers have no setup',()=>{
 const full=aircraftMetrics(profile).fuelCapacityKg,before=12345,stock=3210,limited=aircraftRefuelling(profile,before,stock);
 assert.equal(limited.fuelKg+limited.stockKg,before+stock);assert.equal(limited.stockKg,0);assert.equal(limited.transferKg,stock);assert.equal(limited.durationSeconds,300+3210/(800/60));
 assert.equal(aircraftRefuelling(profile,full,10000).durationSeconds,0);assert.equal(aircraftRefuelling(profile,before,0).durationSeconds,0);
 assert.equal(aircraftRefuelling(profile,before,200000).fuelKg,full);
});

test('invalid units, masses, reserves and fuel fail before a calculation',()=>{
 for(const n of [NaN,Infinity,-1])assert.throws(()=>aircraftRefuelling(profile,1,n));
 assert.throws(()=>aircraftLeg(profile,0,1));assert.throws(()=>aircraftLeg(profile,1000,200000));
 for(const alter of [p=>p.facts.usableTankLitres='126206',p=>p.assumptions.zeroFuelKg=200000,p=>p.assumptions.planningReserveKg=200000,p=>p.assumptions.refuellingLitresPerMinute=0,p=>p.assumptions.cruiseBurnKgPerKm=NaN]) {const p=structuredClone(profile);alter(p);assert.throws(()=>validateAircraftProfile(p));}
});

test('pinned world subset has source runway evidence and explicit unverified sites, not operational approvals',()=>{
 const report=validateCatalog(data.catalog,data.airports,data.fuel,data.profile);assert.equal(report.airports,107);assert.equal(report.screenedCandidates,102);assert.equal(report.missionFeasibility,'not-evaluated');
 for(const id of ['KJFK','EGLL','PHNL','RJTT','FACT','SCEL']) {const a=data.airports.find(a=>a.id===id);assert.ok(a);assert.ok(a.runways.length);assert.equal(a.suitability.operationalApproval,false);assert.equal(a.suitability.status,'screened-candidate');}
 assert.ok(report.unverified.includes('TNCM'));assert.ok(data.airports.find(a=>a.iata==='LIM').ourAirportsId>0);
});

test('finite public game fuel is stable by airport identity, independent of iteration order, and changes with seed',()=>{
 assert.deepEqual(generateFuel([...data.airports].reverse()),data.fuel);assert.notDeepEqual(generateFuel(data.airports,'other-seed').stocks,data.fuel.stocks);
 assert.ok(Object.values(data.fuel.stocks).every(n=>Number.isFinite(n)&&n>=100000&&n<=400000));assert.equal(data.fuel.regeneration,false);
});

test('catalogue rejects duplicate IDs, bad positions, false screening and corrupted stocks',()=>{
 for(const alter of [d=>d.airports.push(structuredClone(d.airports[0])),d=>d.airports[0].latitudeDeg=91,d=>d.airports[0].suitability.operationalApproval=true,d=>d.airports[0].runways[0].lengthM=NaN,d=>d.fuel.stocks[d.airports[0].id]=-1,d=>d.fuel.stocks.extra=1,d=>d.fuel.units='litres']) {const d=structuredClone(data);alter(d);assert.throws(()=>validateCatalog(d.catalog,d.airports,d.fuel,d.profile));}
});
