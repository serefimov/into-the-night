import test from 'node:test';
import assert from 'node:assert/strict';
import { generateScenario } from '../dist/core/scenario.js';
import { forecastPlan, executePlan } from '../dist/core/simulation.js';
import { canonicalJson } from '../dist/core/saves.js';
import { inputFor, readJson, initial, direct, via, until, runBatches, lowerBoundInput } from '../scripts/spike-lib.mjs';
const catalog=readJson('data/spike/airports.json'),scenario=readJson('data/spike/scenario.json');
test('Versioned generation is stable across order, bounded, separated from catalog and keyed by seed',()=>{
 const before=canonicalJson({catalog,scenario});const generated=generateScenario(catalog,scenario);
 assert.equal(canonicalJson(generated),canonicalJson(generateScenario({...catalog,airports:[...catalog.airports].reverse()},scenario)));
 assert.equal(canonicalJson({catalog,scenario}),before);
 assert.deepEqual({...generated.stocks},{LYR:{fuelKg:13253,foodPersonHours:72509},OSL:{fuelKg:7611,foodPersonHours:3214},TOS:{fuelKg:8609,foodPersonHours:17104}});
 assert.notEqual(canonicalJson(generated.stocks),canonicalJson(generateScenario(catalog,{...scenario,seed:'alternative'}).stocks));
 for(const a of generated.world.airports)for(const resource of ['fuelKg','foodPersonHours']) {
  assert.ok(generated.stocks[a.id][resource]>=a.stockBounds[resource][0]);
  assert.ok(generated.stocks[a.id][resource]<=a.stockBounds[resource][1]);
 }
 generated.world.airports[0].stockBounds.fuelKg[0]=999999;
 assert.equal(canonicalJson({catalog,scenario}),before);
});
test('Invalid catalog, duplicate airports and incompatible versions cannot create a world',()=>{
 for(const changes of [{modelVersions:{}},{generatorVersion:2},{catalogVersion:2},{utc:'2026-02-30T00:00:00Z'},{resourceBounds:{}}])assert.throws(()=>generateScenario(catalog,{...scenario,...changes}));
 assert.throws(()=>generateScenario({...catalog,airports:[...catalog.airports,catalog.airports[0]]},scenario));
 assert.throws(()=>initial({...inputFor(),utc:'2026-11-20T00:00:00'}));
 assert.throws(()=>initial({...inputFor(),utc:'2026-02-30T00:00:00Z'}));
 const unsuitable=structuredClone(catalog);for(const runway of unsuitable.airports[0].runways)runway.lengthM=500;
 assert.throws(()=>generateScenario(unsuitable,scenario));
});
test('Two opening routes certify 30 days and lower visible ranges suffice; ninety-day witness is continuous',()=>{
 const input=inputFor();
 for(const opening of [direct,via])for(const seedInput of [input,lowerBoundInput(input)]) {
  const r=runBatches(seedInput,until(seedInput,opening,30));
  assert.equal(r.outcome,'completed');assert.ok(r.state.achievements.includes(30));assert.ok(r.savedResume);
  const remaining=Object.values(r.state.stocks).reduce((n,s)=>n+s.foodPersonHours,0)+r.state.aircraft.foodPersonHours;
  const original=Object.values(seedInput.stocks).reduce((n,s)=>n+s.foodPersonHours,0)+seedInput.aircraft.foodPersonHours;
  assert.ok(Math.abs(original-remaining-30*720)<1e-6);
 }
 const r=runBatches(input,until(input,direct,90));assert.equal(r.outcome,'completed');assert.deepEqual(r.state.achievements,[30,90]);
});
test('Full forecasts reveal no unvisited stock, including the second route after TOS discovery',()=>{
 const input=inputFor(),lo=lowerBoundInput(input),hi=structuredClone(lo);
 hi.stocks.LYR.foodPersonHours=hi.world.airports.find(a=>a.id==='LYR').stockBounds.foodPersonHours[1];
 assert.deepEqual(forecastPlan(lo.world,initial(lo),via[0].actions),forecastPlan(hi.world,initial(hi),via[0].actions));
 const arrivalLo=executePlan(lo.world,initial(lo),via[0].actions).state,arrivalHi=executePlan(hi.world,initial(hi),via[0].actions).state;
 assert.deepEqual(forecastPlan(lo.world,arrivalLo,via[1].actions),forecastPlan(hi.world,arrivalHi,via[1].actions));
});
test('Seasonal warning is not immunity: evacuation is safe, subsequent sunlight is fatal and stocks stay depleted',()=>{
 const input=inputFor();
 const stopped=runBatches(input,[...direct,{actions:[{kind:'auto_wait'}]}]);
 assert.equal(stopped.outcome,'waiting_stopped');assert.deepEqual(stopped.state.waitingWarning.reasons,['sunrise_warning']);
 const escape=executePlan(input.world,stopped.state,[{kind:'load',fuelKg:6000,foodPersonHours:600},{kind:'prepare'},{kind:'fly',destinationId:'TOS'}]);
 assert.equal(escape.outcome,'completed');assert.equal(escape.state.aircraft.airportId,'TOS');
 const death=executePlan(input.world,escape.state,[{kind:'wait',seconds:3*86400}],{confirmRisk:true});
 assert.equal(death.outcome,'death');assert.equal(death.state.death.reason,'sun');
 const repeat=readJson('examples/spike/plans/revisit.json');const result=runBatches(repeat.input,repeat.batches);
 assert.equal(result.state.completedFlights,3);assert.ok(result.state.stocks.LYR.fuelKg<input.stocks.LYR.fuelKg-5999);
 assert.ok(result.state.stocks.LYR.foodPersonHours<input.stocks.LYR.foodPersonHours-600);
});
