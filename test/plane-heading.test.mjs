// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {greatCircle,greatCirclePosition} from '../dist/core/geometry.js';
import {globeFrame,globePoint} from '../dist/core/globe.js';
import {globeFlightPoint,globeFlightHeading} from '../dist/core/globe-flight.js';
import {flightPlanePose} from '../web/flight/plane.mjs';
import {FlightController} from '../web/flight/controller.mjs';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
const at=(latitudeDeg,longitudeDeg)=>({latitudeDeg,longitudeDeg});
const close=(a,b)=>assert.ok(Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))<1e-9,`${a} != ${b}`);
test('projected nose follows the local great-circle tangent in every direction, including a destination behind the globe',()=>{
 const f=globeFrame(at(0,0),1000,700);
 for(const [to,angle] of [[at(0,70),Math.PI/2],[at(0,-70),-Math.PI/2],[at(70,0),0],[at(-70,0),Math.PI]]){
  const path=greatCircle(at(0,0),to);for(const fraction of [0,.3,1])close(globeFlightHeading(path,fraction,f),angle);
 }
 const path=greatCircle(at(0,0),at(0,170)),position=greatCirclePosition(path,60/170);
 assert.equal(globePoint(path.to,f).visible,false);
 assert.ok(globePoint(path.to,f).x<globePoint(position,f).x,'A projected destination chord would point backwards');
 close(globeFlightHeading(path,60/170,f),Math.PI/2);
});
test('westward date-line and exact polar crossings keep continuous headings, independent of scale',()=>{
 for(const [path,center] of [[greatCircle(at(0,-150),at(0,150)),at(0,180)],[greatCircle(at(80,0),at(80,180)),at(90,0)]]){
  let previous=null;
  for(const fraction of [0,.1,.49999999,.5,.50000001,.9,1]){
   const angle=globeFlightHeading(path,fraction,globeFrame(center,1000,700));
   assert.ok(Number.isFinite(angle));if(previous!==null)close(angle,previous);previous=angle;
   for(const zoom of [.75,1.5,5])close(globeFlightHeading(path,fraction,globeFrame(center,390,290,zoom)),angle);
  }
 }
 const path=greatCircle(at(80,0),at(80,180));
 close(globeFlightHeading(path,.5,globeFrame(at(90,0),1000,700)),0);
 close(globeFlightHeading(path,.5,globeFrame(at(90,90),1000,700)),Math.PI/2);
});
test('a radial or almost zero projected tangent has an explicit neutral fallback, with no NaN or cached camera angle',()=>{
 const path=greatCircle(at(0,0),at(0,120)),frame=globeFrame(at(0,0),1000,700);
 for(const lon of [90-1e-8,90,90+1e-8])assert.equal(globeFlightHeading(path,lon/120,frame),null);
 assert.ok(Number.isFinite(globeFlightHeading(path,89/120,frame)));
});
test('real accepted cruise poses follow a paused camera without mutating the party; ground phases and previews never invent movement',async()=>{
 const c=new FlightController(await loadCycleDefinition());
 c.select('BIKF');assert.equal(flightPlanePose(c.view.state,c.choice.forecast,globeFrame(c.view.state.position,1000,700)).directional,false);assert.equal(c.fly(0),true);c.pause(0);
 const accepted=c.activeForecast,cruise=accepted.phases.find(p=>p.label==='cruise').route;
 const initialPose=flightPlanePose(c.view.state,accepted,globeFrame(c.view.state.position,1000,700));
 assert.equal(initialPose.directional,false);assert.equal(initialPose.angleRad,0);
 for(const utc of [cruise.startUtcMs,cruise.startUtcMs+(cruise.endUtcMs-cruise.startUtcMs)/2,cruise.endUtcMs-1]){
  c.advanceTo(utc,0);const before=c.session.save(),forecast=JSON.stringify(accepted),state=c.view.state;
  let previous=null;
  for(const longitudeDeg of [state.position.longitudeDeg-35,state.position.longitudeDeg+35]){
   const frame=globeFrame({...state.position,longitudeDeg},1000,700),pose=flightPlanePose(state,accepted,frame);
   const fraction=(state.utcMs-cruise.startUtcMs)/(cruise.endUtcMs-cruise.startUtcMs),point=globeFlightPoint(cruise.path,fraction,frame);
   assert.equal(pose.visible,true);assert.equal(pose.directional,true);assert.equal(pose.x,point.x);assert.equal(pose.y,point.y);
   if(previous!==null)assert.ok(Math.abs(pose.angleRad-previous)>.01);previous=pose.angleRad;
   c.select('UNNT');assert.equal(c.session.save(),before);assert.equal(JSON.stringify(accepted),forecast);
  }
  const mismatched={...accepted,next:{...accepted.next,airportId:'UNNT'}};
  assert.equal(flightPlanePose(state,mismatched,globeFrame(state.position,1000,700)).directional,false);
 }
 c.advanceTo(cruise.endUtcMs,0);assert.equal(c.view.state.phase,'arrival');
 for(const utc of [cruise.endUtcMs,c.session.endUtcMs-1,c.session.endUtcMs]){
  c.advanceTo(utc,0);const pose=flightPlanePose(c.view.state,accepted,globeFrame(c.view.state.position,1000,700));
  assert.equal(pose.directional,false);assert.equal(pose.angleRad,0);
 }
});
