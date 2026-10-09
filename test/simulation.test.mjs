import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, forecastPlan, executePlan, visibleState, fuelExhaustionSeconds } from '../dist/core/simulation.js';
import { greatCircle } from '../dist/core/geometry.js';
const utc = Date.parse('2026-01-01T00:00:00Z');
const airports = [{ id: 'A', latitudeDeg: 89, longitudeDeg: 0 }, { id: 'B', latitudeDeg: 88, longitudeDeg: 90 }]
  .map(a => ({ ...a, stockBounds: { fuelKg: [0, 18000], foodPersonHours: [0, 400000] } }));
const world = { scenarioId: 'test', scenarioVersion: 1, seed: 'fixed', airports };
const stocks = (food = 5000) => ({ A: { fuelKg: 18000, foodPersonHours: food }, B: { fuelKg: 9000, foodPersonHours: 700 } });
const initial = (food = 5000, boardFood = 100, fuel = 18000) => createSimulation(world, stocks(food), utc, 'A', { fuelKg: fuel, foodPersonHours: boardFood });
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
const exec = (state, actions, opts={}) => executePlan(world,state,actions,opts);
test('parallel loading conserves resources, feeds crew and stops each stream independently', () => {
  const state = initial(5000,0,0), before = structuredClone(state);
  const actions = [{kind:'load',fuelKg:6000,foodPersonHours:120}];
  const r = exec(state,actions);
  assert.equal(r.outcome,'completed'); assert.deepEqual(state,before);
  close(r.state.currentTimeUtc-utc,1800000); close(r.state.aircraft.fuelKg,6000); close(r.state.aircraft.foodPersonHours,120);
  close(r.state.stocks.A.foodPersonHours,5000-120-15); close(r.state.stocks.A.fuelKg,12000);
  assert.deepEqual(forecastPlan(world,state,actions).state,visibleState(world,r.state));
});
test('warehouse feeding limits a valid food request; fuel continues after exhaustion', () => {
  const r=exec(initial(120,100,0),[{kind:'load',fuelKg:6000,foodPersonHours:120}]);
  assert.equal(r.outcome,'completed');
  const transferred=120*1.2/(1.2+30/3600);
  close(r.events.find(e=>e.kind==='loading_completed').detail.foodPersonHours,transferred);
  assert.ok(r.events.some(e=>e.kind==='loading_limited'));
  close(r.state.aircraft.foodPersonHours,100+120-15); close(r.state.stocks.A.foodPersonHours,0);
  assert.ok(r.state.aircraft.foodPersonHours<=2160);
});
test('ground food uses warehouse first, consumes board afterwards and never burns fuel', () => {
  const r=exec(initial(1,10),[{kind:'wait',seconds:240}]);
  assert.equal(r.outcome,'completed'); close(r.state.stocks.A.foodPersonHours,0); close(r.state.aircraft.foodPersonHours,9); close(r.state.aircraft.fuelKg,18000);
});
test('invalid amounts, capacity, initial warehouse and late errors roll back entire plan', () => {
  for (const action of [{kind:'load',fuelKg:-1,foodPersonHours:0},{kind:'load',fuelKg:NaN,foodPersonHours:0},
    {kind:'load',fuelKg:0,foodPersonHours:Infinity},{kind:'load',fuelKg:18001,foodPersonHours:0},
    {kind:'load',fuelKg:0,foodPersonHours:2161},{kind:'load',fuelKg:0,foodPersonHours:5001},{kind:'wait',seconds:NaN},{kind:'service'}]) {
    const state=initial(5000,0,0), r=exec(state,[{kind:'wait',seconds:10},action],{confirmRisk:true});
    assert.equal(r.outcome,'validation_error'); assert.deepEqual(r.state,state); assert.deepEqual(r.events,[]);
  }
});
test('preparation, one service after landing, known return warehouse depletion and flight fuel', () => {
  const state=initial(), distance=greatCircle(airports[0],airports[1]).distanceKm;
  assert.equal(exec(state,[{kind:'fly',destinationId:'B'}]).outcome,'validation_error');
  let r=exec(state,[{kind:'prepare'},{kind:'fly',destinationId:'B'},{kind:'service'}]);
  assert.equal(r.outcome,'needs_discovery'); assert.equal(r.state.serviceRequired,true); assert.equal(r.state.departurePrepared,false);
  assert.equal(r.state.completedFlights,1); close(r.state.aircraft.fuelKg,18000-distance*3);
  close(r.state.aircraft.foodPersonHours,100-(1800+distance/850*3600)*30/3600);
  r=exec(r.state,[{kind:'service'},{kind:'prepare'},{kind:'fly',destinationId:'A'}]);
  assert.equal(r.outcome,'completed'); assert.equal(r.state.completedFlights,2); assert.equal(r.state.serviceRequired,true);
  close(r.state.stocks.A.foodPersonHours,5000-7.5); assert.ok(r.state.stocks.B.foodPersonHours<700);
  assert.equal(exec(r.state,[{kind:'service'},{kind:'service'}]).outcome,'validation_error');
});
test('exact cruise fuel is allowed, deficit always blocked and event time is analytic', () => {
  const distance=greatCircle(airports[0],airports[1]).distanceKm, fuel=distance*3;
  const r=exec(initial(5000,100,fuel),[{kind:'prepare'},{kind:'fly',destinationId:'B'}]);
  assert.equal(r.outcome,'completed'); close(r.state.aircraft.fuelKg,0);
  assert.equal(exec(initial(5000,100,fuel-1),[{kind:'prepare'},{kind:'fly',destinationId:'B'}],{confirmRisk:true}).outcome,'validation_error');
  assert.equal(fuelExhaustionSeconds(30,20,100),50); assert.equal(fuelExhaustionSeconds(60,20,100),null);
});
test('forecast cannot distinguish hidden warehouse worlds; execution reveals only on landing', () => {
  const a=initial(),b=initial(); b.stocks.B={fuelKg:100,foodPersonHours:2};
  const actions=[{kind:'prepare'},{kind:'fly',destinationId:'B'},{kind:'load',fuelKg:500,foodPersonHours:10}];
  assert.deepEqual(forecastPlan(world,a,actions),forecastPlan(world,b,actions));
  const forecast=forecastPlan(world,a,actions); assert.equal(forecast.outcome,'needs_discovery');
  assert.deepEqual(forecast.state.warehouses.B,airports[1].stockBounds);
  const result=exec(b,actions); assert.equal(result.outcome,'needs_discovery'); assert.deepEqual(visibleState(world,result.state).warehouses.B,b.stocks.B);
});
test('hunger warning requires explicit risk; death saves partial loading and active flight position', () => {
  let state=initial(0,1,0), actions=[{kind:'load',fuelKg:6000,foodPersonHours:0}];
  const before=structuredClone(state), forecast=forecastPlan(world,state,actions);
  assert.equal(forecast.outcome,'death'); assert.equal(forecast.state.death.reason,'food');
  assert.equal(exec(state,actions).outcome,'risk_confirmation_required'); assert.deepEqual(state,before);
  let r=exec(state,actions,{confirmRisk:true}); close(r.state.currentTimeUtc-utc,120000); close(r.state.aircraft.fuelKg,400);
  close(r.state.activeAction.transferred.fuelKg,400); assert.deepEqual(visibleState(world,r.state),forecast.state);
  state=initial(5000,8); r=exec(state,[{kind:'prepare'},{kind:'fly',destinationId:'B'}],{confirmRisk:true});
  assert.equal(r.outcome,'death'); assert.equal(r.state.aircraft.airportId,null); assert.equal(r.state.aircraft.activeFlight.stage,'cruise');
  assert.ok(r.state.distanceKm>0); assert.ok(r.state.distanceKm<greatCircle(airports[0],airports[1]).distanceKm);
});
test('first solar/resource event wins; zero-duration checks immediate danger', () => {
  const w={...world,airports:[{...airports[0],latitudeDeg:0,longitudeDeg:0}]};
  let state=createSimulation(w,{A:{fuelKg:0,foodPersonHours:100}},Date.parse('2026-01-01T06:00:00Z'),'A',{fuelKg:0,foodPersonHours:0});
  let r=executePlan(w,state,[{kind:'wait',seconds:3600}],{confirmRisk:true}); assert.equal(r.state.death.reason,'sun');
  state=createSimulation(w,{A:{fuelKg:0,foodPersonHours:0.01}},Date.parse('2026-01-01T06:00:00Z'),'A',{fuelKg:0,foodPersonHours:0});
  r=executePlan(w,state,[{kind:'wait',seconds:3600}],{confirmRisk:true}); assert.equal(r.state.death.reason,'food');
  r=exec(initial(0,0),[{kind:'wait',seconds:0}],{confirmRisk:true}); assert.equal(r.state.death.reason,'food'); assert.equal(r.state.currentTimeUtc,utc);
});
test('achievements persist without ending world; death wins equal timestamp', () => {
  let r=exec(initial(30000,0),[{kind:'wait',seconds:31*86400}]);
  assert.equal(r.outcome,'completed'); assert.deepEqual(r.state.achievements,[30]); assert.equal(r.state.phase,'planning');
  assert.equal(r.events.find(e=>e.kind==='achievement').utcMs,utc+30*86400000);
  r=exec(initial(30*24*30,0),[{kind:'wait',seconds:30*86400}],{confirmRisk:true});
  assert.equal(r.outcome,'death'); assert.deepEqual(r.state.achievements,[]);
});
test('numerical uncertainty blocks execution without invented death or partial mutation', () => {
  const state=initial(),r=exec(state,[{kind:'wait',seconds:86400}],{maxEvaluations:4});
  assert.equal(r.outcome,'needs_refinement'); assert.deepEqual(r.state,state); assert.deepEqual(r.events,[]);
});
test('all later milestones continue the same world and maintain chronological events', () => {
  for (const [days,previous] of [[90,[30]],[180,[30,90]],[365,[30,90,180]]]) {
    const state=initial(1000,0);state.startTimeUtc=utc-(days-1)*86400000;state.achievements=previous;
    const r=exec(state,[{kind:'wait',seconds:86400}]);
    assert.equal(r.outcome,'completed');assert.deepEqual(r.state.achievements,[...previous,days]);
    assert.equal(r.state.seed,state.seed);assert.equal(r.state.currentTimeUtc,utc+86400000);
    assert.ok(r.events.every((e,i)=>i===0||e.utcMs>=r.events[i-1].utcMs));
  }
});
test('solar death resources converge when first-event bracket is refined', () => {
  const w={...world,airports:[{...airports[0],latitudeDeg:0,longitudeDeg:0}]};
  const state=createSimulation(w,{A:{fuelKg:18000,foodPersonHours:100}},Date.parse('2026-01-01T06:00:00Z'),'A',{fuelKg:0,foodPersonHours:10});
  const results=[0.5,0.1,0.01].map(eventToleranceSeconds=>executePlan(w,state,[{kind:'load',fuelKg:18000,foodPersonHours:0}],{confirmRisk:true,eventToleranceSeconds}));
  for(const r of results) {assert.equal(r.outcome,'death');assert.equal(r.state.death.reason,'sun');}
  const times=results.map(r=>r.state.currentTimeUtc);assert.ok(Math.max(...times)-Math.min(...times)<1000);
  for(const r of results)close(r.state.aircraft.fuelKg,(r.state.currentTimeUtc-state.currentTimeUtc)/1000*200/60);
});
test('loading balances stay within capacity for varied depletion and stream order', () => {
  for(let i=1;i<=80;i++) {
    const warehouse=10+i*7.7,board=i*0.71, fuelRequest=i*19.3,foodRequest=warehouse*((i%9+1)/10);
    const state=initial(warehouse,board,0),r=exec(state,[{kind:'load',fuelKg:fuelRequest,foodPersonHours:foodRequest}],{confirmRisk:true});
    assert.ok(['completed','death'].includes(r.outcome));
    const seconds=(r.state.currentTimeUtc-utc)/1000;
    assert.ok(r.state.aircraft.foodPersonHours>=0&&r.state.aircraft.foodPersonHours<=2160);
    assert.ok(r.state.aircraft.fuelKg>=0&&r.state.aircraft.fuelKg<=18000);
    assert.ok(Math.abs(r.state.stocks.A.foodPersonHours+r.state.aircraft.foodPersonHours-(warehouse+board-seconds*30/3600))<1e-6);
    close(r.state.stocks.A.fuelKg+r.state.aircraft.fuelKg,18000);
  }
});
