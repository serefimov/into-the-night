import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { forecastStanding, searchStationarySunrise, WAITING_CONFIG } from '../dist/core/waiting.js';
import { createSimulation, executePlan, SIMULATION_CONFIG } from '../dist/core/simulation.js';
import { solarExposure } from '../dist/core/solar.js';
import { SOLAR_MODEL } from '../dist/core/config.js';
const cases = [
  { name: 'north_pole_winter', position: { latitudeDeg: 90, longitudeDeg: 0 }, utc: '2026-11-20T00:00:00Z' },
  { name: 'south_pole_winter', position: { latitudeDeg: -90, longitudeDeg: 0 }, utc: '2026-05-20T00:00:00Z' },
  { name: 'longyearbyen_geometry_only', position: { latitudeDeg: 78.246111, longitudeDeg: 15.465556 }, utc: '2026-11-20T00:00:00Z' },
  { name: 'equatorial_night', position: { latitudeDeg: 0, longitudeDeg: 0 }, utc: '2026-01-01T00:00:00Z' }
];
function measure(operation) {
  operation(); operation(); // warm-up is excluded
  const timings = [];
  let result;
  for (let i=0;i<9;i++) { const start=performance.now();result=operation();timings.push(performance.now()-start); }
  timings.sort((a,b)=>a-b);
  return { result, timingMs: { min: timings[0], median: timings[4], max: timings[8], repetitions: 9, warmups: 2 } };
}
const controls=cases.map(control=>{
  const startUtcMs=Date.parse(control.utc);
  const measured=measure(()=>forecastStanding({position:control.position,startUtcMs,foodPersonHours:100000,crew:30}));
  const forecast=measured.result;
  assert.equal(forecast.sunrise.status,'found');
  assert.equal(forecast.sunrise.requestedEndUtcMs-startUtcMs,370*86400000);
  assert.ok(forecast.sunrise.timeErrorBoundSeconds<=0.5);
  assert.equal(solarExposure(control.position,forecast.sunrise.eventUtcMs).safe,false);
  assert.equal(solarExposure(control.position,forecast.sunrise.safeUntilUtcMs-1000).safe,true);
  assert.ok(forecast.sunrise.evaluations<20000);
  return { ...control, forecast, timingMs:measured.timingMs };
});
const p=cases[0].position;
const world={scenarioId:'370-day-standing-control',scenarioVersion:1,seed:'control-1',airports:[{
  id:'P',...p,stockBounds:{fuelKg:[0,0],foodPersonHours:[100000,100000]}}]};
const state=createSimulation(world,{P:{fuelKg:0,foodPersonHours:100000}},Date.parse(cases[0].utc),'P',{fuelKg:0,foodPersonHours:100});
const measuredExecution=measure(()=>executePlan(world,state,[{kind:'wait',seconds:370*86400}],{confirmRisk:true}));
assert.equal(measuredExecution.result.outcome,'death');assert.equal(measuredExecution.result.state.death.reason,'sun');
const measuredAuto=measure(()=>executePlan(world,state,[{kind:'auto_wait'}]));
assert.equal(measuredAuto.result.outcome,'waiting_stopped');
const boundary=searchStationarySunrise(p,Date.parse('2040-12-01T00:00:00Z'));
assert.equal(boundary.status,'not_found_within_horizon');assert.equal(boundary.rangeLimited,true);
const report={
  reportVersion:1, simulationVersion:SIMULATION_CONFIG.simulationVersion, simulationConfigVersion:SIMULATION_CONFIG.version,
  waitingConfig:WAITING_CONFIG, solarModelVersion:SOLAR_MODEL.version,
  environment:{node:process.version,platform:platform(),release:release(),arch:arch(),cpuModel:cpus()[0]?.model??'unknown',logicalCpus:cpus().length},
  controls,
  requested370DayManualWait:{requestedSeconds:370*86400,outcome:measuredExecution.result.outcome,
    death:measuredExecution.result.state.death,elapsedModelSeconds:(measuredExecution.result.state.currentTimeUtc-state.currentTimeUtc)/1000,
    timingMs:measuredExecution.timingMs},
  automaticExecution:{outcome:measuredAuto.result.outcome,stopUtcMs:measuredAuto.result.state.currentTimeUtc,
    foodRemainingPersonHours:measuredAuto.result.state.stocks.P.foodPersonHours+measuredAuto.result.state.aircraft.foodPersonHours,
    timingMs:measuredAuto.timingMs},
  rangeBoundary:boundary,
  limitations:[
    '370 days is the requested horizon; chronological search and execution stop at the first event. No claim of survival for 370 days.',
    'Timing is machine-specific, not a frame rate or a CI wall-clock requirement.',
    'These controls are algorithm regressions using the accepted Sun; independent ephemeris validation remains validate:solar.',
    'No real airport or monthly strategy is implied by synthetic pole fixtures; physical ephemeris timing error is separate from the <=1 s event bracket.'
  ],passed:true
};
if (process.argv.length>2) {
  if (process.argv.length!==3||process.argv[2]!=='--write-report')throw new Error('Use --write-report or no arguments.');
  writeFileSync('docs/WAITING_VALIDATION.json',JSON.stringify(report,null,2)+'\n');
}
process.stdout.write(JSON.stringify(report,null,2)+'\n');
