import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastStanding, searchStationarySunrise, WAITING_CONFIG } from '../dist/core/waiting.js';
import { createSimulation, forecastPlan, executePlan, visibleState } from '../dist/core/simulation.js';
import { solarExposure } from '../dist/core/solar.js';
import { SOLAR_MODEL } from '../dist/core/config.js';
const north = { latitudeDeg: 90, longitudeDeg: 0 }, south = { latitudeDeg: -90, longitudeDeg: 0 };
const start = Date.parse('2026-11-20T00:00:00Z');
const request = (foodPersonHours = 100000, position = north, startUtcMs = start) => ({ position, startUtcMs, foodPersonHours, crew: 30 });
const world = position => ({ scenarioId:'polar-control',scenarioVersion:1,seed:'fixed',airports:[
  {id:'P',...position,stockBounds:{fuelKg:[0,18000],foodPersonHours:[0,400000]}},
  {id:'hidden',latitudeDeg:0,longitudeDeg:0,stockBounds:{fuelKg:[0,18000],foodPersonHours:[0,400000]}}] });
const state = (food=100000, board=100, position=north, utc=start, serviced=true) => {
  const w=world(position);
  return [w,createSimulation(w,{P:{fuelKg:0,foodPersonHours:food},hidden:{fuelKg:100,foodPersonHours:200}},utc,'P',{fuelKg:0,foodPersonHours:board},serviced)];
};
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
test('370-day seasonal search finds the end of both polar nights across monthly segments',()=>{
  for(const [position,utc,month] of [[north,start,2],[south,Date.parse('2026-05-20T00:00:00Z'),8]]) {
    const result=searchStationarySunrise(position,utc);
    assert.equal(result.status,'found');assert.equal(result.requestedEndUtcMs-utc,370*86400000);
    assert.ok(result.segments>=4);assert.ok(result.evaluations<20000);
    assert.equal(new Date(result.eventUtcMs).getUTCMonth(),month);
    assert.ok(result.eventUtcMs-utc>100*86400000);assert.ok(result.timeErrorBoundSeconds<=0.5);
    assert.equal(solarExposure(position,result.eventUtcMs).safe,false);
    assert.equal(solarExposure(position,result.bracketUtcMs[0]-1000).safe,true);
  }
});
test('night endpoints separated by whole days do not hide daytime; initial sunlight is immediate',()=>{
  const position={latitudeDeg:0,longitudeDeg:0},utc=Date.parse('2026-01-01T00:00:00Z');
  assert.ok(solarExposure(position,utc).safe&&solarExposure(position,utc+86400000).safe);
  for(const maxIntervalSeconds of [86400,3600,900]) {
    const r=searchStationarySunrise(position,utc,{maxIntervalSeconds});
    assert.equal(r.status,'found');assert.ok(r.eventUtcMs>utc+5*3600000&&r.eventUtcMs<utc+7*3600000);
  }
  const r=searchStationarySunrise(position,utc+12*3600000);assert.equal(r.eventUtcMs,utc+12*3600000);
});
test('maximum survival and notification are distinct, and either hunger or Sun can limit standing',()=>{
  const hunger=forecastStanding(request(30*24*10));
  assert.equal(hunger.maximum.reason,'food');close(hunger.maximum.seconds,10*86400);
  close(hunger.automatic.seconds,7*86400);assert.deepEqual(hunger.automatic.reasons,['food_threshold']);
  const sun=forecastStanding(request());assert.equal(sun.maximum.reason,'sun');
  assert.deepEqual(sun.automatic.reasons,['sunrise_warning']);
  close(sun.sunrise.bracketUtcMs[0]-sun.automatic.stopUtcMs,12*3600000);
  assert.ok(sun.maximum.seconds>sun.automatic.seconds);
});
test('automatic waiting conserves resources, needs no fuel, does not load, and stops the remaining plan',()=>{
  const [w,s]=state(30*24*33,100),before=structuredClone(s);
  const actions=[{kind:'auto_wait'},{kind:'prepare'}];
  const forecast=forecastPlan(w,s,actions),actual=executePlan(w,s,actions);
  assert.equal(actual.outcome,'waiting_stopped');assert.deepEqual(forecast.state,visibleState(w,actual.state));assert.deepEqual(forecast.events,actual.events);
  assert.deepEqual(s,before);assert.equal(actual.state.aircraft.fuelKg,0);assert.equal(actual.state.aircraft.foodPersonHours,100);
  close(actual.state.stocks.P.foodPersonHours+actual.state.aircraft.foodPersonHours,2160);
  assert.equal(actual.state.departurePrepared,false);assert.equal(actual.state.activeAction,null);assert.equal(actual.state.phase,'planning');
  assert.deepEqual(actual.state.achievements,[30]);
  assert.ok(actual.events.some(e=>e.kind==='food_threshold'));
  assert.ok(!actual.events.some(e=>e.kind==='loading_started'||e.kind==='departure_preparation_started'));
  assert.deepEqual(actual.state.stocks.hidden,s.stocks.hidden);assert.deepEqual(forecast.state.warehouses.hidden,w.airports[1].stockBounds);
});
test('months of polar waiting reach solar warning with forecast/execution equality and ordered events',()=>{
  const [w,s]=state();const actions=[{kind:'auto_wait'}];
  const r=executePlan(w,s,actions);assert.equal(r.outcome,'waiting_stopped');
  assert.deepEqual(visibleState(w,r.state),forecastPlan(w,s,actions).state);
  assert.deepEqual(r.waiting.automatic.reasons,['sunrise_warning']);assert.ok(r.state.currentTimeUtc-start>100*86400000);
  close(r.state.stocks.P.foodPersonHours,100000-(r.state.currentTimeUtc-start)/3600000*30);
  assert.deepEqual(r.state.achievements,[30,90]);assert.equal(r.state.aircraft.foodPersonHours,100);
  assert.ok(r.events.every((e,i)=>!i||e.utcMs>=r.events[i-1].utcMs));
});
test('simultaneous thresholds emit both notices and already reached stops never advance or loop',()=>{
  const sun=forecastStanding(request()),time=sun.automatic.stopUtcMs;
  const food=(time-start)/3600000*30+2160;
  const [w,s]=state(food,0),r=executePlan(w,s,[{kind:'auto_wait'}]);
  assert.equal(r.outcome,'waiting_stopped');assert.deepEqual(r.waiting.automatic.reasons,['food_threshold','sunrise_warning']);
  assert.equal(r.state.currentTimeUtc,time);
  const repeat=executePlan(w,r.state,[{kind:'auto_wait'},{kind:'auto_wait'}]);
  assert.equal(repeat.outcome,'waiting_stopped');assert.equal(repeat.state.currentTimeUtc,time);assert.equal(repeat.waiting.automatic.alreadyReached,true);
  assert.ok(!repeat.events.some(e=>e.kind==='auto_wait_started'));
  const [smallWorld,small]=state(100,0),immediate=executePlan(smallWorld,small,[{kind:'auto_wait'}]);
  assert.equal(immediate.state.currentTimeUtc,start);assert.equal(immediate.waiting.automatic.alreadyReached,true);
});
test('configured reserve thresholds change the stop without transfer or forced departure',()=>{
  const [w,s]=state(30*24*10,0);
  const r=executePlan(w,s,[{kind:'auto_wait',options:{foodThresholdCrewHours:24,sunriseWarningHours:6}}]);
  assert.equal(r.outcome,'waiting_stopped');close(r.waiting.automatic.seconds,9*86400);
  close(r.state.stocks.P.foodPersonHours,720);assert.equal(r.state.aircraft.airportId,'P');assert.equal(r.state.aircraft.foodPersonHours,0);
});
test('manual waiting after notification needs explicit risk confirmation; service still obeys physical danger',()=>{
  const [w,s]=state(100,0);const notice=executePlan(w,s,[{kind:'auto_wait'}]);
  const blocked=executePlan(w,notice.state,[{kind:'wait',seconds:60}]);assert.equal(blocked.outcome,'risk_confirmation_required');assert.deepEqual(blocked.state,notice.state);
  assert.equal(executePlan(w,notice.state,[{kind:'wait',seconds:60}],{confirmRisk:true}).outcome,'completed');
  const position={latitudeDeg:0,longitudeDeg:0};const utc=Date.parse('2026-01-01T06:00:00Z');
  const [serviceWorld,unserviced]=state(1000,100,position,utc,false);
  const before=structuredClone(unserviced);
  assert.equal(executePlan(serviceWorld,unserviced,[{kind:'service'}]).outcome,'risk_confirmation_required');
  const death=executePlan(serviceWorld,unserviced,[{kind:'service'}],{confirmRisk:true});
  assert.equal(death.outcome,'death');assert.equal(death.state.death.reason,'sun');assert.equal(death.state.serviceRequired,true);
  assert.ok(!death.events.some(e=>e.kind==='service_completed'));assert.deepEqual(unserviced,before);
});
test('no sunrise in supported remainder reports horizon, and automatic waiting reserves warning margin',()=>{
  const utc=Date.parse('2040-12-01T00:00:00Z'),r=forecastStanding(request(400000,north,utc));
  assert.equal(r.sunrise.status,'not_found_within_horizon');assert.equal(r.sunrise.rangeLimited,true);assert.equal(r.sunrise.eventUtcMs,null);
  assert.ok(r.sunrise.horizonEndUtcMs<SOLAR_MODEL.endUtcMsExclusive);assert.equal(r.sunrise.requestedEndUtcMs-utc,370*86400000);
  assert.equal(r.maximum.status,'horizon_limited');assert.equal(r.automatic.status,'search_horizon');
  close(r.automatic.stopUtcMs,r.sunrise.horizonEndUtcMs-12*3600000);
  const horizonFood=(r.automatic.stopUtcMs-utc)/3600000*30+2160+30;
  assert.equal(forecastStanding(request(horizonFood,north,utc)).automatic.status,'search_horizon');
  const last=searchStationarySunrise(north,r.sunrise.horizonEndUtcMs);assert.equal(last.status,'not_found_within_horizon');assert.equal(last.safeUntilUtcMs,last.startUtcMs);
});
test('budget exhaustion is uncertainty; earlier food threshold can still be certified',()=>{
  const options={maxEvaluations:4};const r=forecastStanding(request(),options);
  assert.equal(r.sunrise.status,'indeterminate');assert.equal(r.sunrise.reason,'evaluation_budget');assert.equal(r.maximum.status,'needs_refinement');
  const [w,s]=state();const blocked=executePlan(w,s,[{kind:'auto_wait'}],options);
  assert.equal(blocked.outcome,'needs_refinement');assert.deepEqual(blocked.state,s);assert.deepEqual(blocked.events,[]);
  const immediate=forecastStanding(request(100),options);assert.equal(immediate.automatic.alreadyReached,true);
  const beforeHorizon=forecastStanding(request(0.01),options);assert.equal(beforeHorizon.maximum.reason,'food');
});
test('invalid options fail without mutations and no fake short-horizon safety',()=>{
  for(const options of [{horizonDays:369},{horizonDays:Infinity},{foodThresholdCrewHours:NaN},{sunriseWarningHours:-1},{maxIntervalSeconds:0}]) {
    const [w,s]=state(),r=executePlan(w,s,[{kind:'auto_wait',options}]);
    assert.equal(r.outcome,'validation_error');assert.deepEqual(r.state,s);assert.deepEqual(r.events,[]);
  }
  assert.equal(WAITING_CONFIG.horizonDays,370);
});
test('polar search converges within supported tolerance and reports stricter uncertainty',()=>{
  const results=[1,0.5,0.25].map(eventToleranceSeconds=>forecastStanding(request(),{eventToleranceSeconds,maxIntervalSeconds:3600}));
  assert.ok(results.every(r=>r.sunrise.status==='found'));
  const times=results.map(r=>r.automatic.stopUtcMs);assert.ok(Math.max(...times)-Math.min(...times)<=1000);
  const finer=forecastStanding(request(),{eventToleranceSeconds:0.1,maxIntervalSeconds:3600});
  assert.equal(finer.sunrise.status,'indeterminate');assert.equal(finer.automatic.status,'needs_refinement');
});
test('real stationary grazing horizon is uncertain, never skipped as a later sunrise',()=>{
  // Tune latitude to the daily maximum using the SAME Sun. This is an algorithm regression, not independent validation.
  const utc=Date.parse('2026-12-21T00:00:00Z');
  function maximum(latitudeDeg) {
    let lo=utc+10*3600000,hi=utc+14*3600000;
    for(let i=0;i<65;i++) {
      const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;
      if(solarExposure({latitudeDeg,longitudeDeg:0},a).q<solarExposure({latitudeDeg,longitudeDeg:0},b).q)lo=a;else hi=b;
    }
    return solarExposure({latitudeDeg,longitudeDeg:0},(lo+hi)/2).q;
  }
  let lo=66,hi=67;
  for(let i=0;i<55;i++) {const mid=(lo+hi)/2;if(maximum(mid)>0)lo=mid;else hi=mid;}
  const result=searchStationarySunrise({latitudeDeg:hi,longitudeDeg:0},utc);
  assert.equal(result.status,'indeterminate');assert.equal(result.reason,'near_horizon');assert.equal(result.eventUtcMs,null);
  assert.ok(result.safeUntilUtcMs<utc+14*3600000);
});
test('death has priority over immediate notification, including the initial sun/food tie',()=>{
  const utc=Date.parse('2026-01-01T12:00:00Z'),position={latitudeDeg:0,longitudeDeg:0};
  const [w,s]=state(0,0,position,utc);
  const f=forecastStanding(request(0,position,utc));assert.equal(f.maximum.reason,'sun');
  assert.equal(executePlan(w,s,[{kind:'auto_wait'}]).outcome,'risk_confirmation_required');
  const r=executePlan(w,s,[{kind:'auto_wait'}],{confirmRisk:true});assert.equal(r.state.death.reason,'sun');assert.equal(r.state.currentTimeUtc,utc);
  assert.ok(!r.events.some(e=>e.kind==='food_threshold'||e.kind==='sunrise_warning'));
  const [polarWorld,empty]=state(0,0);assert.equal(executePlan(polarWorld,empty,[{kind:'auto_wait'}],{confirmRisk:true}).state.death.reason,'food');
});
test('hunger inside a solar bracket uses a truncated search and agrees with physical execution',()=>{
  const position={latitudeDeg:0,longitudeDeg:0},utc=Date.parse('2026-01-01T00:00:00Z');
  const root=searchStationarySunrise(position,utc);
  const hungerMs=(root.bracketUtcMs[0]+root.bracketUtcMs[1])/2;
  const food=(hungerMs-utc)/1000*30/3600;
  const forecast=forecastStanding(request(food,position,utc));
  const [w,s]=state(food,0,position,utc);
  const r=executePlan(w,s,[{kind:'wait',seconds:(hungerMs-utc)/1000+60}],{confirmRisk:true});
  if(forecast.maximum.status==='limited') {
    assert.equal(r.outcome,'death');assert.equal(r.state.death.reason,forecast.maximum.reason);
    close(r.state.currentTimeUtc,forecast.maximum.boundaryUtcMs,1000);
  } else {assert.equal(forecast.maximum.status,'needs_refinement');assert.equal(r.outcome,'needs_refinement');}
});
test('monthly segments share one bounded search budget and never manufacture a later horizon',()=>{
  const r=searchStationarySunrise(north,start,{maxEvaluations:4000});
  assert.equal(r.status,'indeterminate');assert.equal(r.reason,'evaluation_budget');
  assert.ok(r.segments>=2);assert.ok(r.evaluations<=4000);assert.ok(r.safeUntilUtcMs<r.horizonEndUtcMs);
});
