import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUtc, solarExposure, solarDirection, createRoutePlan, routePhasePosition,
 routePhaseNormal, checkRouteSafety, executeSolarRoute, ROUTE_MODEL } from '../dist/core/index.js';
import { routeCliOutput } from '../dist/route-cli-command.js';
const point=(latitudeDeg,longitudeDeg)=>({latitudeDeg,longitudeDeg});
const oslo=point(60.202778,11.083889),tromso=point(69.681389,18.917778),lyr=point(78.246111,15.465556);
const request=(utc,waypoints)=>({startUtcMs:parseUtc(utc),waypoints});
const q=(phase,time)=>{
 const n=routePhaseNormal(phase,time),s=solarDirection(time);
 return n.reduce((sum,v,i)=>sum+v*s[i],0);
};
function scanFirstEvent(plan,stepMs=1000) {
 for(const phase of plan.phases) {
  let lo=phase.startUtcMs;
  if(q(phase,lo)>=0)return lo;
  while(lo<phase.endUtcMs) {
   const hi=Math.min(phase.endUtcMs,lo+stepMs);
   if(q(phase,hi)>=0) {
    let a=lo,b=hi;
    while(b-a>0.01){const m=a+(b-a)/2;if(q(phase,m)>=0)b=m;else a=m;}
    return b;
   }
   lo=hi;
  }
 }
 return null;
}

test('flight phase duration, preparation and service match the contract for every leg',()=>{
 const r=request('2026-11-20T03:00:00Z',[oslo,tromso,lyr]);
 const plan=createRoutePlan(r);
 assert.equal(plan.phases.length,10);
 assert.deepEqual(plan.phases.map(p=>p.kind),['preparation','takeoff','cruise','landing','service',
  'preparation','takeoff','cruise','landing','service']);
 const seconds=(plan.endUtcMs-plan.startUtcMs)/1000;
 assert.ok(Math.abs(seconds-(plan.distanceKm/850*3600+2*3600))<1e-6);
 for(let i=0;i<plan.phases.length;i++){
  const phase=plan.phases[i];
  if(phase.kind!=='cruise')assert.equal(phase.endUtcMs-phase.startUtcMs,900000);
  if(i>0)assert.equal(phase.startUtcMs,plan.phases[i-1].endUtcMs);
 }
 const withService=createRoutePlan({...r,initialServiceRequired:true});
 assert.equal(withService.phases[0].kind,'initial_service');
 assert.equal(withService.endUtcMs-plan.endUtcMs,900000);
 assert.equal(checkRouteSafety(r).status,'safe');
 const executed=executeSolarRoute(r);
 assert.equal(executed.outcome,'completed');assert.equal(executed.stoppedUtcMs,plan.endUtcMs);
 assert.deepEqual(executed.position,lyr);
 const before=JSON.stringify(r);createRoutePlan(r);checkRouteSafety(r);assert.equal(JSON.stringify(r),before);
});

test('night at both endpoints does not hide a daytime cruise',()=>{
 const r=request('2026-03-20T00:00:00Z',[point(0,-80),point(0,80)]);
 const plan=createRoutePlan(r),result=checkRouteSafety(r);
 assert.equal(solarExposure(r.waypoints[0],plan.startUtcMs).safe,true);
 assert.equal(solarExposure(r.waypoints[1],plan.endUtcMs).safe,true);
 assert.equal(result.status,'unsafe');assert.equal(result.event.phase,'cruise');
 assert.ok(result.event.q>=0);assert.ok(result.event.timeErrorBoundSeconds<=1);
 const reference=scanFirstEvent(plan);
 assert.ok(result.event.bracketUtcMs[0]<=reference&&reference<=result.event.bracketUtcMs[1]);
 const executed=executeSolarRoute(r);
 assert.deepEqual(executed.safety,result);
 assert.equal(executed.stoppedUtcMs,result.event.utcMs);assert.equal(executed.outcome,'solar_death');
 assert.deepEqual(executed.position,result.event.position);
});

test('ground phases and cruise are all checked, including initial maintenance',()=>{
 for(const [time,kind] of [['05:10','service'],['05:20','landing'],['05:30','cruise'],['05:40','takeoff'],['06:00','preparation']]) {
  const r=request(`2026-03-20T${time}:00Z`,[point(0,0),point(0,1)]);
  const result=checkRouteSafety(r);
  assert.equal(result.status,'unsafe');assert.equal(result.event.phase,kind);
  const reference=scanFirstEvent(createRoutePlan(r));
  assert.ok(Math.abs(result.event.utcMs-reference)<=1000,kind);
 }
 const r={...request('2026-03-20T06:00:00Z',[point(0,0),point(0,1)]),initialServiceRequired:true};
 assert.equal(checkRouteSafety(r).event.phase,'initial_service');
 const day=checkRouteSafety(request('2026-03-20T12:00:00Z',[point(0,0),point(0,1)]));
 assert.equal(day.event.utcMs,day.startUtcMs);assert.equal(day.event.timeErrorBoundSeconds,0);
});

test('first-event brackets converge under smaller search intervals and time tolerance',()=>{
 const r=request('2026-03-20T00:00:00Z',[point(0,-80),point(0,80)]);
 const reference=scanFirstEvent(createRoutePlan(r));
 for(const maxIntervalSeconds of [3600,900,120,30])for(const eventToleranceSeconds of [1,0.5,0.1,0.01]){
  const result=checkRouteSafety(r,{maxIntervalSeconds,eventToleranceSeconds});
  assert.equal(result.status,'unsafe');
  assert.ok(result.event.timeErrorBoundSeconds<=eventToleranceSeconds);
  assert.ok(result.event.bracketUtcMs[0]<=reference&&reference<=result.event.bracketUtcMs[1]);
  assert.ok(Math.abs(result.event.utcMs-reference)<=eventToleranceSeconds*1000);
 }
});

test('date-line and polar arcs have no singularity in the route validator',()=>{
 for(const r of [request('2026-03-20T12:00:00Z',[point(0,179),point(0,-179)]),
  request('2026-12-21T00:00:00Z',[point(80,0),point(80,180)])]) {
  const result=checkRouteSafety(r),plan=createRoutePlan(r);
  assert.equal(result.status,'safe');
  assert.equal(scanFirstEvent(plan,60000),null);
  const cruise=plan.phases.find(p=>p.kind==='cruise');
  const mid=routePhasePosition(cruise,(cruise.startUtcMs+cruise.endUtcMs)/2);
  assert.ok(Number.isFinite(mid.latitudeDeg)&&Number.isFinite(mid.longitudeDeg));
 }
});

test('budget exhaustion and unresolved horizon do not complete a route or cause a death',()=>{
 const r=request('2026-11-20T03:00:00Z',[oslo,tromso]);
 const result=checkRouteSafety(r,{maxEvaluations:4});
 assert.equal(result.status,'indeterminate');assert.equal(result.reason,'evaluation_budget');
 assert.equal(result.event,null);assert.ok(result.evaluations<=4);
 const executed=executeSolarRoute(r,{maxEvaluations:4});
 assert.equal(executed.outcome,'needs_refinement');assert.deepEqual(executed.safety,result);
 assert.ok(executed.stoppedUtcMs<result.endUtcMs);
});

test('invalid routes and out-of-range arrival fail before forecast/execution',()=>{
 const startUtcMs=parseUtc('2026-11-20T03:00:00Z');
 for(const r of [{startUtcMs,waypoints:[]},{startUtcMs,waypoints:[oslo]},
  {startUtcMs,waypoints:[oslo,oslo]},{startUtcMs,waypoints:[point(0,0),point(0,180)]},
  {startUtcMs,waypoints:[oslo,point(100,0)]},{startUtcMs,waypoints:[oslo,tromso],initialServiceRequired:1},
  request('2040-12-31T23:59:59Z',[oslo,tromso])])assert.throws(()=>checkRouteSafety(r),RangeError);
});

test('route CLI loads the JSON plan, supports both modes, and validates options',()=>{
 const args=['--utc','2026-11-20T03:00:00Z','--plan','examples/oslo-tromso.json'];
 const load=path=>readFileSync(path,'utf8');
 const forecast=JSON.parse(routeCliOutput(args,load));assert.equal(forecast.status,'safe');
 const executed=JSON.parse(routeCliOutput([...args,'--mode','execute'],load));
 assert.equal(executed.outcome,'completed');assert.deepEqual(executed.safety.event,forecast.event);
 for(const extra of [['--mode','other'],['--event-tolerance','2'],['--max-interval','0'],
  ['--plan','duplicate'],['--unknown','1'],['--max-evaluations','3']]) {
  assert.throws(()=>routeCliOutput([...args,...extra],load),RangeError);
 }
 assert.throws(()=>routeCliOutput(args,()=>'{'),SyntaxError);
 assert.throws(()=>routeCliOutput(args,()=>JSON.stringify({waypoints:[oslo,tromso],fuel:1})),RangeError);
 assert.match(routeCliOutput(['--help'],load),/^Usage:/);
});
