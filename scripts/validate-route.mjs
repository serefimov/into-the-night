import { readFileSync } from 'node:fs';
import { parseUtc, solarExposure, checkRouteSafety, createRoutePlan, routePhaseNormal,
 solarDirection, ROUTE_MODEL, executeSolarRoute } from '../dist/core/index.js';
function q(phase,time) {
 const n=routePhaseNormal(phase,time),s=solarDirection(time);
 return n.reduce((sum,v,i)=>sum+v*s[i],0);
}
// Independent dense sampling of the selected model, followed by bisection.
// It is a regression oracle for these fixtures, not a full-route certificate.
function denseFirst(plan) {
 for(const phase of plan.phases) {
  let lo=phase.startUtcMs;
  if(q(phase,lo)>=0)return lo;
  while(lo<phase.endUtcMs) {
   const hi=Math.min(phase.endUtcMs,lo+1000);
   if(q(phase,hi)>=0){let a=lo,b=hi;while(b-a>0.01){const mid=a+(b-a)/2;if(q(phase,mid)>=0)b=mid;else a=mid;}return b;}
   lo=hi;
  }
 }
 return null;
}
const point=(latitudeDeg,longitudeDeg)=>({latitudeDeg,longitudeDeg});
const oslo=JSON.parse(readFileSync(new URL('../examples/oslo-tromso.json',import.meta.url),'utf8'));
const dark=JSON.parse(readFileSync(new URL('../examples/dark-endpoints.json',import.meta.url),'utf8'));
const cases=[
 ['oslo-tromso','2026-11-20T03:00:00Z',oslo],
 ['dark-endpoints','2026-03-20T00:00:00Z',dark],
 ['date-line','2026-03-20T12:00:00Z',{waypoints:[point(0,179),point(0,-179)]}],
 ['polar-arc','2026-12-21T00:00:00Z',{waypoints:[point(80,0),point(80,180)]}],
];
const rows=cases.map(([name,utc,data])=>{
 const request={...data,startUtcMs:parseUtc(utc)},plan=createRoutePlan(request),result=checkRouteSafety(request);
 const first=denseFirst(plan),executed=executeSolarRoute(request);
 return {name,utc,status:result.status,distanceKm:plan.distanceKm,
  durationSeconds:(plan.endUtcMs-plan.startUtcMs)/1000,
  departureQ:solarExposure(request.waypoints[0],plan.startUtcMs).q,
  endQ:solarExposure(request.waypoints.at(-1),plan.endUtcMs).q,
  event:result.event,denseFirstUtcMs:first,
  witnessMinusDenseSeconds:first===null?null:(result.event?.utcMs-first)/1000,
  evaluations:result.evaluations,
  forecastMatchesExecution:JSON.stringify(result)===JSON.stringify(executed.safety)};
});
const route={...dark,startUtcMs:parseUtc('2026-03-20T00:00:00Z')};
const reference=denseFirst(createRoutePlan(route));
const convergence=[];
for(const maxIntervalSeconds of [3600,900,120,30])for(const eventToleranceSeconds of [1,0.5,0.1,0.01]) {
 const result=checkRouteSafety(route,{maxIntervalSeconds,eventToleranceSeconds});
 convergence.push({maxIntervalSeconds,eventToleranceSeconds,status:result.status,
  eventBracketSeconds:result.event?.timeErrorBoundSeconds,
  witnessMinusDenseSeconds:(result.event?.utcMs-reference)/1000,evaluations:result.evaluations});
}
const passed=rows.every(row=>row.forecastMatchesExecution&&row.status!=='indeterminate'&&
 (row.event===null?row.denseFirstUtcMs===null:Math.abs(row.witnessMinusDenseSeconds)<=1))&&
 convergence.every(row=>row.status==='unsafe'&&row.eventBracketSeconds<=row.eventToleranceSeconds&&
 Math.abs(row.witnessMinusDenseSeconds)<=row.eventToleranceSeconds);
console.log(JSON.stringify({routeModel:ROUTE_MODEL.version,solarModel:ROUTE_MODEL.solarModelVersion,
 cases:rows,convergence,passed},null,2));
if(!passed)process.exitCode=1;
