import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulationSession, ForecastTimeline, SessionError } from '../dist/core/sessions.js';
import { serializeSession, restoreSession, saveChecksum } from '../dist/core/saves.js';
import { createSimulation, executePlan, visibleState } from '../dist/core/simulation.js';
import { greatCirclePosition } from '../dist/core/geometry.js';
import { createFlightPhases } from '../dist/core/route.js';
const start=Date.parse('2026-01-01T00:00:00Z');
const airports=[{id:'A',latitudeDeg:89,longitudeDeg:0},{id:'B',latitudeDeg:88,longitudeDeg:90}]
  .map(a=>({...a,stockBounds:{fuelKg:[0,18000],foodPersonHours:[0,150000]}}));
const world={scenarioId:'save-control',scenarioVersion:1,seed:'fixed',airports};
const state=(warehouse=5000,board=100,fuel=18000)=>createSimulation(world,{A:{fuelKg:18000,foodPersonHours:warehouse},B:{fuelKg:9000,foodPersonHours:700}},start,'A',{fuelKg:fuel,foodPersonHours:board});
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const rechecksum=save=>JSON.stringify({...save,checksum:saveChecksum(save.payload)});
test('stateAt reads coherent loading fractions without committing future time, resources or events',()=>{
  const origin=state(5000,0,0),plan=[{kind:'load',fuelKg:6000,foodPersonHours:120}];
  const session=new SimulationSession(world,origin,plan),saved=serializeSession(session);
  const early=session.stateAt(start+50000),late=session.stateAt(start+200000);
  close(early.state.aircraft.fuelKg,200/60*50);close(early.state.aircraft.foodPersonHours,60);
  close(early.state.warehouses.A.foodPersonHours,5000-60-50*30/3600);
  close(late.state.aircraft.foodPersonHours,120);close(late.state.aircraft.fuelKg,200/60*200);
  close(late.state.activeAction.transferred.foodPersonHours,120);assert.equal(late.state.activeAction.elapsedSeconds,200);
  assert.equal(early.state.currentTimeUtc,start+50000);assert.equal(early.outcome,'paused');
  assert.equal(session.currentTimeUtc,start);assert.equal(serializeSession(session),saved);
  assert.ok(!early.events.some(e=>e.kind==='loading_completed'));
  assert.equal(origin.aircraft.fuelKg,0);
});
test('flight boundaries and cruise position use the original trajectory and preserve fuel/food',()=>{
  const origin=state(),plan=[{kind:'prepare'},{kind:'fly',destinationId:'B'}],session=new SimulationSession(world,origin,plan);
  const phases=createFlightPhases(start+900000,airports[0],airports[1]);
  const takeoff=session.stateAt(phases[0].startUtcMs),cruiseStart=session.stateAt(phases[1].startUtcMs);
  assert.equal(takeoff.state.aircraft.activeFlight.stage,'takeoff');assert.equal(takeoff.state.aircraft.airportId,null);
  assert.equal(cruiseStart.state.aircraft.activeFlight.stage,'cruise');close(cruiseStart.state.aircraft.fuelKg,18000);
  const time=phases[1].startUtcMs+(phases[1].endUtcMs-phases[1].startUtcMs)/2;
  const half=session.stateAt(time),position=greatCirclePosition(phases[1].path,0.5);
  close(half.state.aircraft.position.latitudeDeg,position.latitudeDeg);close(half.state.aircraft.position.longitudeDeg,position.longitudeDeg);
  close(half.state.aircraft.fuelKg,18000-phases[1].path.distanceKm*3/2);
  close(half.state.aircraft.foodPersonHours,100-(time-(start+900000))/1000*30/3600);
  assert.equal(half.state.aircraft.activeFlight.stage,'cruise');assert.equal(half.state.completedFlights,0);
  const landing=session.stateAt(phases[2].startUtcMs);assert.equal(landing.state.aircraft.activeFlight.stage,'landing');assert.equal(landing.state.aircraft.airportId,null);
});
test('future landing never reveals a warehouse; only committed landing reveals it',()=>{
  const session=new SimulationSession(world,state(),[{kind:'prepare'},{kind:'fly',destinationId:'B'}]);
  const preview=session.stateAt(session.endUtcMs);
  assert.deepEqual(preview.state.warehouses.B,airports[1].stockBounds);assert.deepEqual(preview.state.discovered,['A']);
  assert.ok(!preview.events.some(e=>e.kind==='airport_discovered'));
  const actual=session.resume();assert.equal(actual.state.warehouses.B.foodPersonHours,700);assert.deepEqual(actual.state.discovered,['A','B']);
  assert.ok(actual.newEvents.some(e=>e.kind==='airport_discovered'));
});
test('stop, save and restore in every flight phase give identical future and exactly-once journal',()=>{
  const origin=state(),plan=[{kind:'prepare'},{kind:'fly',destinationId:'B'}],full=executePlan(world,origin,plan);
  const phases=createFlightPhases(start+900000,airports[0],airports[1]);
  const cuts=[start,start+450000,...phases.flatMap(p=>[p.startUtcMs,(p.startUtcMs+p.endUtcMs)/2,p.endUtcMs])];
  for(const cut of cuts) {
    const session=new SimulationSession(world,origin,plan),first=session.stopAt(cut),payload=JSON.parse(serializeSession(session)).payload;
    assert.equal(payload.snapshot.currentTimeUtc,cut);assert.equal(payload.cursorUtcMs,cut);
    const restored=restoreSession(serializeSession(session),world),last=restored.resume();
    assert.deepEqual(last.state,visibleState(world,full.state));assert.deepEqual([...first.newEvents,...last.newEvents],full.events);
    assert.deepEqual(last.events,full.events);assert.deepEqual(restored.resume().newEvents,[]);
  }
});
test('loading depletion boundaries and repeated fractional splits do not repeat transfers',()=>{
  const origin=state(120,100,0),plan=[{kind:'load',fuelKg:6000,foodPersonHours:120}],full=executePlan(world,origin,plan);
  let session=new SimulationSession(world,origin,plan),journal=[];
  const depletion=start+120/(1.2+30/3600)*1000;
  for(const cut of [start+0.125,depletion-0.01,depletion,depletion+0.01,start+1500000]) {
    const stopped=session.stopAt(cut);journal.push(...stopped.newEvents);
    session=restoreSession(serializeSession(session));
    assert.equal(session.currentTimeUtc,cut);
  }
  const final=session.resume();journal.push(...final.newEvents);
  assert.deepEqual(final.state,visibleState(world,full.state));assert.deepEqual(journal,full.events);
  assert.equal(journal.filter(e=>e.kind==='loading_limited').length,1);
});
test('month-scale waiting preserves achievements and warning timing through different splits',()=>{
  const input=JSON.parse(readFileSync('examples/polar-wait.json','utf8'));
  const origin=createSimulation(input.world,input.stocks,Date.parse(input.utc),input.airportId,input.aircraft);
  const full=executePlan(input.world,origin,input.actions);
  let session=new SimulationSession(input.world,origin,input.actions),journal=[];
  for(const days of [10,30,30.0001,60,90,100]) {
    const time=origin.currentTimeUtc+days*86400000,view=session.stateAt(time);
    assert.equal(view.state.currentTimeUtc,time);assert.deepEqual(view.state.achievements,[30,90].filter(d=>d<=days));
    close(view.state.warehouses.NORTH_CONTROL.foodPersonHours,100000-days*24*30);
    journal.push(...session.stopAt(time).newEvents);session=restoreSession(serializeSession(session));
  }
  const final=session.resume();journal.push(...final.newEvents);
  assert.deepEqual(final.state,visibleState(input.world,full.state));assert.deepEqual(journal,full.events);
  assert.equal(final.outcome,'waiting_stopped');assert.deepEqual(final.state.waitingWarning,full.state.waitingWarning);
});
test('starvation and Sun stop preview/commits at the first death and preserve partial progress',()=>{
  const origin=state(0,1,0),plan=[{kind:'load',fuelKg:6000,foodPersonHours:0}];
  assert.throws(()=>new SimulationSession(world,origin,plan),e=>e instanceof SessionError&&e.outcome==='risk_confirmation_required');
  const forecast=new ForecastTimeline(world,origin,plan);assert.equal(forecast.stateAt(start+3600000).outcome,'death');
  const session=new SimulationSession(world,origin,plan,{confirmRisk:true}),before=session.stateAt(session.endUtcMs-1);
  assert.equal(before.state.death,null);assert.equal(before.outcome,'paused');
  const dead=session.stopAt(start+3600000);assert.equal(dead.state.currentTimeUtc,start+120000);assert.equal(dead.state.death.reason,'food');
  close(dead.state.activeAction.transferred.fuelKg,400);assert.equal(dead.state.activeAction.elapsedSeconds,120);
  const restored=restoreSession(serializeSession(session)),after=restored.stopAt(start+7200000);
  assert.deepEqual(after.state,dead.state);assert.deepEqual(after.newEvents,[]);
  const p={...airports[0],latitudeDeg:0,longitudeDeg:0},w={...world,airports:[p,airports[1]]};
  const solarOrigin=createSimulation(w,{A:{fuelKg:18000,foodPersonHours:1000},B:{fuelKg:9000,foodPersonHours:700}},Date.parse('2026-01-01T06:00:00Z'),'A',{fuelKg:0,foodPersonHours:100});
  const sun=new SimulationSession(w,solarOrigin,[{kind:'wait',seconds:3600}],{confirmRisk:true});
  const split=sun.stopAt(sun.endUtcMs-10),end=restoreSession(serializeSession(sun)).resume();
  assert.equal(end.state.death.reason,'sun');assert.deepEqual([...split.newEvents,...end.newEvents],executePlan(w,solarOrigin,[{kind:'wait',seconds:3600}],{confirmRisk:true}).events);
});
test('zero-time and simultaneous milestones are ordered without duplicate dispatch',()=>{
  const session=new SimulationSession(world,state(),[{kind:'wait',seconds:0},{kind:'prepare'}]);
  const first=session.stopAt(start),repeat=session.stopAt(start);
  assert.equal(first.newEvents.filter(e=>e.kind==='wait_completed').length,1);assert.deepEqual(repeat.newEvents,[]);
  const restored=restoreSession(serializeSession(session));assert.ok(!restored.resume().newEvents.some(e=>e.kind==='wait_completed'));
});
test('corrupted and incompatible saves fail without mutating the active session',()=>{
  const session=new SimulationSession(world,state(),[{kind:'prepare'},{kind:'fly',destinationId:'B'}]);session.stopAt(start+1000000);
  const valid=serializeSession(session),before=serializeSession(session);
  const bad=[];
  bad.push('{',valid.replace('resources-resume-3','resources-resume-X'));
  for(const mutate of [s=>s.formatVersion=99,s=>s.payload.schemaVersion=2,s=>s.payload.simulationVersion='old',s=>s.payload.configVersion=99,
    s=>s.payload.seed='changed',s=>s.payload.cursorUtcMs+=1000,s=>s.payload.consumedEvents=-1,s=>s.payload.consumedEvents=0,
    s=>s.payload.snapshot.aircraft.fuelKg+=1,s=>s.payload.snapshot.aircraft.position.latitudeDeg+=1,
    s=>s.payload.journal.push({kind:'invented',utcMs:start,detail:{}}),s=>s.payload.origin.stocks.A.foodPersonHours=-1,
    s=>s.payload.origin.aircraft.fuelKg=null,s=>s.payload.origin.serviceRequired='yes']) {
    const save=JSON.parse(valid);mutate(save);bad.push(rechecksum(save));
  }
  for(const save of bad) {assert.throws(()=>restoreSession(save,world),/save|Save|version|mismatch|replay|Invalid|invalid/i);assert.equal(serializeSession(session),before);}
  assert.throws(()=>restoreSession(valid,{...world,seed:'other'}),/different scenario/);
  assert.throws(()=>session.stopAt(start),/rewind/);assert.equal(serializeSession(session),before);
});
test('saving a completed ground state preserves depleted finite warehouses for the next plan',()=>{
  const w={...world,airports:airports.map(a=>({...a,stockBounds:{fuelKg:[18000,18000],foodPersonHours:[5000,5000]}}))};
  const origin=createSimulation(w,{A:{fuelKg:18000,foodPersonHours:5000},B:{fuelKg:18000,foodPersonHours:5000}},start,'A',{fuelKg:0,foodPersonHours:0});
  const done=executePlan(w,origin,[{kind:'load',fuelKg:6000,foodPersonHours:100}]);
  const next=new SimulationSession(w,done.state,[{kind:'prepare'}]);
  next.stopAt(done.state.currentTimeUtc+1000);
  assert.deepEqual(restoreSession(serializeSession(next)).resume().state,visibleState(w,executePlan(w,done.state,[{kind:'prepare'}]).state));
});
test('standing interpolation splits warehouse/board feeding and death wins the 30-day achievement tie',()=>{
  const short=new SimulationSession(world,state(1,10),[{kind:'wait',seconds:1800}],{confirmRisk:true});
  const view=short.stateAt(start+1000000);
  assert.equal(view.state.warehouses.A.foodPersonHours,0);close(view.state.aircraft.foodPersonHours,11-1000*30/3600);
  assert.equal(view.state.activeAction.elapsedSeconds,1000);
  const session=new SimulationSession(world,state(30*24*30,0),[{kind:'wait',seconds:30*86400}],{confirmRisk:true});
  const first=session.stopAt(start+29*86400000),last=restoreSession(serializeSession(session)).resume();
  assert.equal(last.state.death.reason,'food');assert.deepEqual(last.state.achievements,[]);
  assert.ok(![...first.newEvents,...last.newEvents].some(e=>e.kind==='achievement'));
});
test('saved warnings retain risk authorization, and simultaneous auto thresholds dispatch once',()=>{
  const initial=state(100000,0),request={kind:'auto_wait'};
  const probe=new SimulationSession(world,initial,[request]);
  const stop=probe.savePayload().origin.currentTimeUtc+probe.stateAt(probe.endUtcMs).waiting.automatic.seconds*1000;
  const origin=state((stop-start)/3600000*30+2160,0);
  const session=new SimulationSession(world,origin,[request]);
  const pause=session.stopAt(session.endUtcMs-1000),end=restoreSession(serializeSession(session)).resume();
  assert.deepEqual(end.state.waitingWarning.reasons,['food_threshold','sunrise_warning']);
  assert.equal([...pause.newEvents,...end.newEvents].filter(e=>e.kind==='food_threshold').length,1);
  assert.equal([...pause.newEvents,...end.newEvents].filter(e=>e.kind==='sunrise_warning').length,1);
  const completed=restoreSession(serializeSession(session)).resume();
  const actual=executePlan(world,origin,[request]).state;
  assert.deepEqual(completed.state,visibleState(world,actual));
  assert.throws(()=>new SimulationSession(world,actual,[{kind:'wait',seconds:10}]),/risk confirmation/i);
  const manual=new SimulationSession(world,actual,[{kind:'wait',seconds:10}],{confirmRisk:true});manual.stopAt(actual.currentTimeUtc+1000);
  assert.equal(restoreSession(serializeSession(manual)).resume().outcome,'completed');
});
test('date-line and pole interpolation remain finite and replay unchanged',()=>{
  for(const coords of [[{latitudeDeg:80,longitudeDeg:179},{latitudeDeg:80,longitudeDeg:-179}],
    [{latitudeDeg:89,longitudeDeg:0},{latitudeDeg:89,longitudeDeg:180}]]) {
    const w={...world,airports:airports.map((a,i)=>({...a,...coords[i]}))};
    const initial=createSimulation(w,{A:{fuelKg:18000,foodPersonHours:5000},B:{fuelKg:9000,foodPersonHours:700}},start,'A',{fuelKg:18000,foodPersonHours:100});
    const plan=[{kind:'prepare'},{kind:'fly',destinationId:'B'}],session=new SimulationSession(w,initial,plan);
    const phases=createFlightPhases(start+900000,...coords),mid=(phases[1].startUtcMs+phases[1].endUtcMs)/2;
    const view=session.stopAt(mid);assert.ok(Number.isFinite(view.state.aircraft.position.latitudeDeg));assert.ok(Number.isFinite(view.state.aircraft.position.longitudeDeg));
    assert.deepEqual(restoreSession(serializeSession(session)).resume().state,visibleState(w,executePlan(w,initial,plan).state));
  }
});
