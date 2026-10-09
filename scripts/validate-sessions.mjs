import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createSimulation, executePlan, visibleState, SIMULATION_CONFIG } from '../dist/core/simulation.js';
import { SimulationSession } from '../dist/core/sessions.js';
import { serializeSession, restoreSession, canonicalJson } from '../dist/core/saves.js';
const cases=['resource-plan','polar-wait'].map(name=>({name,input:JSON.parse(readFileSync(`examples/${name}.json`,'utf8'))}));
const loading={world:{scenarioId:'partial-loading-control',scenarioVersion:1,seed:'fixed',airports:[{
  id:'P',latitudeDeg:89,longitudeDeg:0,stockBounds:{fuelKg:[0,18000],foodPersonHours:[0,5000]}}]},
  stocks:{P:{fuelKg:18000,foodPersonHours:120}},utc:'2026-01-01T00:00:00Z',airportId:'P',aircraft:{fuelKg:0,foodPersonHours:100},
  actions:[{kind:'load',fuelKg:6000,foodPersonHours:120}]};
cases.push({name:'partial-loading',input:loading});
const results=cases.map(({name,input})=>{
  const state=createSimulation(input.world,input.stocks,Date.parse(input.utc),input.airportId,input.aircraft);
  const expected=executePlan(input.world,state,input.actions);
  const continuous=new SimulationSession(input.world,state,input.actions);continuous.resume();
  const duration=continuous.endUtcMs-state.currentTimeUtc;
  let session=new SimulationSession(input.world,state,input.actions),journal=[];
  const cuts=[0,.01,.25,.5,.75,.99].map(fraction=>state.currentTimeUtc+duration*fraction);
  for(const cut of cuts) {
    const stopped=session.stopAt(cut);journal.push(...stopped.newEvents);
    assert.equal(stopped.state.currentTimeUtc,cut);
    const saved=serializeSession(session);session=restoreSession(saved,input.world);
    assert.equal(serializeSession(session),saved);
  }
  const resumed=session.resume();journal.push(...resumed.newEvents);
  assert.equal(canonicalJson(session.savePayload().snapshot),canonicalJson(expected.state));
  assert.deepEqual(resumed.state,visibleState(input.world,expected.state));
  assert.deepEqual(journal,expected.events);assert.deepEqual(session.resume().newEvents,[]);
  assert.equal(serializeSession(session),serializeSession(continuous));
  return {name,scenarioId:input.world.scenarioId,scenarioVersion:input.world.scenarioVersion,seed:input.world.seed,
    actions:input.actions,cutsUtcMs:cuts,outcome:resumed.outcome,finalUtcMs:resumed.state.currentTimeUtc,
    eventCount:journal.length,finalStateExactlyEqual:true,finalSaveExactlyEqual:true,journalExactlyEqual:true};
});
const initial=createSimulation(loading.world,loading.stocks,Date.parse(loading.utc),loading.airportId,loading.aircraft);
const session=new SimulationSession(loading.world,initial,loading.actions);
let maxFuelErrorKg=0,maxFoodErrorPersonHours=0;
for(let i=0;i<=100;i++) {
  const utc=initial.currentTimeUtc+i/100*(session.endUtcMs-initial.currentTimeUtc),seconds=(utc-initial.currentTimeUtc)/1000;
  const view=session.stateAt(utc);
  const depletion=120/(1.2+30/3600);
  const expectedFuel=Math.min(6000,seconds*200/60);
  const expectedBoard=seconds<=depletion?100+seconds*1.2:220-seconds*30/3600;
  maxFuelErrorKg=Math.max(maxFuelErrorKg,Math.abs(view.state.aircraft.fuelKg-expectedFuel));
  maxFoodErrorPersonHours=Math.max(maxFoodErrorPersonHours,Math.abs(view.state.aircraft.foodPersonHours-expectedBoard));
}
assert.ok(maxFuelErrorKg<=1e-6);assert.ok(maxFoodErrorPersonHours<=1e-6);
const report={reportVersion:1,simulationVersion:SIMULATION_CONFIG.simulationVersion,schemaVersion:3,
  configVersion:SIMULATION_CONFIG.version,results,
  tolerance:{finalState:'exact IEEE-754 values, canonical JSON equality',journal:'exact order, values and timestamps',
    intermediateResourcesAbsolute:1e-6,unit:'kg or person-hours',samples:101,maxFuelErrorKg,maxFoodErrorPersonHours},
  limitations:['Tested fixtures are controls, not verified long-term strategies.',
    'Resume replays the accepted plan from its private origin. Querying stateAt uses recorded linear phases; it does not replay per frame.',
    'Physical solar error is separate from numeric event brackets. Previews and execution stop at the first terminal or planning boundary.'],passed:true};
if(process.argv.length>2) {
  if(process.argv.length!==3||process.argv[2]!=='--write-report')throw new Error('Use --write-report or no arguments.');
  writeFileSync('docs/SESSION_VALIDATION.json',JSON.stringify(report,null,2)+'\n');
}
process.stdout.write(JSON.stringify(report,null,2)+'\n');
