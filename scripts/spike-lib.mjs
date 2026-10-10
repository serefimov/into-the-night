import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUtc } from '../dist/core/time.js';
import { generateScenario } from '../dist/core/scenario.js';
import { createSimulation, executePlan, forecastPlan, tracePlan, SIMULATION_CONFIG } from '../dist/core/simulation.js';
import { solarExposure } from '../dist/core/solar.js';
import { routePhasePosition, ROUTE_MODEL } from '../dist/core/route.js';
import { SimulationSession } from '../dist/core/sessions.js';
import { serializeSession, restoreSession, canonicalJson } from '../dist/core/saves.js';
export const DAY = 86400000;
export const readJson = path => JSON.parse(readFileSync(path,'utf8'));
export function inputFor(scenario=readJson('data/spike/scenario.json'),catalog=readJson('data/spike/airports.json')) {
  const {world,stocks}=generateScenario(catalog,scenario);
  return {world,stocks,utc:scenario.utc,airportId:scenario.airportId,aircraft:scenario.aircraft,serviced:scenario.serviced};
}
export function initial(input) {
  return createSimulation(input.world,input.stocks,parseUtc(input.utc),input.airportId,input.aircraft,input.serviced);
}
export const direct=[{actions:[{kind:'prepare'},{kind:'fly',destinationId:'LYR'}]},{actions:[{kind:'service'}]}];
export const via=[{actions:[{kind:'prepare'},{kind:'fly',destinationId:'TOS'}]},
  {actions:[{kind:'service'},{kind:'load',fuelKg:0,foodPersonHours:720},{kind:'prepare'},{kind:'fly',destinationId:'LYR'}]},
  {actions:[{kind:'service'}]}];
export function runBatches(input,batches,searchOptions={},collect=true) {
  let state=initial(input); const stages=[]; let savedResume=true, outcome='completed';
  for (const batch of batches) {
    const options={...searchOptions,confirmRisk:batch.confirmRisk===true};
    const before=state;
    const result=executePlan(input.world,before,batch.actions,options);
    outcome=result.outcome;
    if(collect && !['validation_error','needs_refinement','risk_confirmation_required'].includes(outcome)) {
      const session=new SimulationSession(input.world,before,batch.actions,options);
      session.stopAt(before.currentTimeUtc+(session.endUtcMs-before.currentTimeUtc)/2);
      const restored=restoreSession(serializeSession(session),input.world); restored.resume();
      savedResume &&= canonicalJson(restored.savePayload().snapshot)===canonicalJson(result.state);
      assert.ok(savedResume,'save/resume changed the final state');
      const trace=tracePlan(input.world,before,batch.actions,options,'execute');
      let qMin=Infinity,qMax=-Infinity,qUpperBound=-Infinity,samples=0;
      for(const entry of trace.entries) if(entry.kind==='segment') {
        const lo=entry.before.currentTimeUtc,hi=entry.after.currentTimeUtc;
        const count=Math.max(1,Math.ceil((hi-lo)/900000));
        const w=entry.phase.path?entry.phase.path.angleRad/((entry.phase.endUtcMs-entry.phase.startUtcMs)/1000):0;
        const curvature=w*w+2*w*ROUTE_MODEL.solarSpeedBoundPerSecond+ROUTE_MODEL.solarCurvatureBoundPerSecond2;
        let previousQ=null;
        for(let i=0;i<=count;i++) {
          const utc=lo+(hi-lo)*i/count;
          const q=solarExposure(routePhasePosition(entry.phase,utc),utc).q;
          qMin=Math.min(qMin,q);qMax=Math.max(qMax,q);samples++;
          if(previousQ!==null)qUpperBound=Math.max(qUpperBound,Math.max(previousQ,q)+curvature*((hi-lo)/count/1000)**2/8+ROUTE_MODEL.evaluationErrorBound);
          previousQ=q;
        }
      }
      stages.push({startUtcMs:before.currentTimeUtc,endUtcMs:result.state.currentTimeUtc,
        startUtc:new Date(before.currentTimeUtc).toISOString(),endUtc:new Date(result.state.currentTimeUtc).toISOString(),
        actions:batch.actions,outcome,airportId:result.state.aircraft.airportId,
        aircraft:{fuelKg:result.state.aircraft.fuelKg,foodPersonHours:result.state.aircraft.foodPersonHours},
        warehouses:result.state.stocks,discovered:result.state.discovered,events:result.events,
        solarSamples:{intervalSecondsAtMost:900,count:samples,qMin:samples?qMin:null,qMax:samples?qMax:null,
          sampledMaximumAltitudeDeg:samples?Math.asin(qMax)*180/Math.PI:null,
          conservativeQUpperBound:samples?qUpperBound:null,
          conservativeAltitudeUpperBoundDeg:samples?Math.asin(Math.max(-1,Math.min(1,qUpperBound)))*180/Math.PI:null},
        waiting:result.waiting?{sunrise:result.waiting.sunrise,automatic:result.waiting.automatic,maximum:result.waiting.maximum}:null});
    }
    state=result.state;
    if(!['completed','waiting_stopped'].includes(outcome)) break;
  }
  return {state,stages,outcome,savedResume};
}
export function until(input,batches,days) {
  const state=runBatches(input,batches,{},false).state;
  const seconds=(parseUtc(input.utc)+days*DAY-state.currentTimeUtc)/1000;
  assert.ok(seconds>=0);
  return [...batches,{actions:[{kind:'wait',seconds}],confirmRisk:true}];
}
export function lowerBoundInput(input) {
  // Starting airport is already discovered: retain its known exact warehouse.
  return {...input,stocks:Object.fromEntries(input.world.airports.map(a=>[a.id,a.id===input.airportId?input.stocks[a.id]:
    {fuelKg:a.stockBounds.fuelKg[0],foodPersonHours:a.stockBounds.foodPersonHours[0]}]))};
}
export function publicForecastIndependent(input,batches) {
  const lo=lowerBoundInput(input);
  const hi={...input,stocks:Object.fromEntries(input.world.airports.map(a=>[a.id,a.id===input.airportId?input.stocks[a.id]:
    {fuelKg:a.stockBounds.fuelKg[1],foodPersonHours:a.stockBounds.foodPersonHours[1]}]))};
  assert.deepEqual(forecastPlan(input.world,initial(lo),batches[0].actions),forecastPlan(input.world,initial(hi),batches[0].actions));
  return true;
}
export function compact(result) {
  const {state}=result;
  return {outcome:result.outcome,endUtcMs:state.currentTimeUtc,endUtc:new Date(state.currentTimeUtc).toISOString(),
    survivedDays:(state.currentTimeUtc-state.startTimeUtc)/DAY,death:state.death,
    achievements:state.achievements,completedFlights:state.completedFlights,distanceKm:state.distanceKm,
    savedResume:result.savedResume,stages:result.stages};
}
export const modelConfig=SIMULATION_CONFIG;
