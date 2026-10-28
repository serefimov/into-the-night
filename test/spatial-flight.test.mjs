// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {greatCircle} from '../dist/core/geometry.js';
import {globeFrame,globePoint} from '../dist/core/globe.js';
import {globeFlightPoint,globeFlightHeading,globeFlightLines} from '../dist/core/globe-flight.js';
import {flightPlanePose} from '../web/flight/plane.mjs';
import {FlightController} from '../web/flight/controller.mjs';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
const at=(latitudeDeg,longitudeDeg)=>({latitudeDeg,longitudeDeg});

test('cruising plane is lifted radially; a surface airport stays at its ground anchor',async()=>{
 const controller=new FlightController(await loadCycleDefinition());
 controller.select('BIKF');assert.equal(controller.fly(0),true);controller.pause(0);
 const route=controller.activeForecast.phases.find(p=>p.label==='cruise').route;
 controller.advanceTo((route.startUtcMs+route.endUtcMs)/2,0);
 const state=controller.view.state,before=controller.session.save();
 const frame=globeFrame({...state.position,longitudeDeg:state.position.longitudeDeg+35},1000,700);
 const ground=globePoint(state.position,frame),pose=flightPlanePose(state,controller.activeForecast,frame);
 assert.ok(Math.abs(pose.x-(frame.cx+(ground.x-frame.cx)*1.025))<1e-9,'Aircraft must use the route radius, not a fixed vertical offset');
 assert.ok(Math.abs(pose.y-(frame.cy+(ground.y-frame.cy)*1.025))<1e-9);
 assert.equal(controller.session.save(),before);
});

test('Earth hides only points intersecting its sphere, including rear elevated points above the limb',()=>{
 const frame=globeFrame(at(0,0),1000,700);
 assert.equal(globePoint(at(0,95),frame).visible,false,'A surface point behind the horizon is hidden');
 assert.equal(globePoint(at(0,95),frame,1.025).visible,true,'An elevated rear point outside the Earth silhouette is visible');
 assert.equal(globePoint(at(0,110),frame,1.025).visible,false,'A rear point projected inside the Earth is hidden');
 assert.equal(globePoint(at(0,180),frame,1.025).visible,false);
 const limb=90+Math.acos(1/1.025)*180/Math.PI;
 assert.equal(globePoint(at(0,limb-1e-6),frame,1.025).visible,true);
 assert.equal(globePoint(at(0,limb+1e-6),frame,1.025).visible,false);
 assert.throws(()=>globePoint(at(0,0),frame,.9),RangeError);
});

test('spatial route anchors and tangent match for ramps, poles, date line and arbitrary camera/zoom',()=>{
 const paths=[greatCircle(at(0,-60),at(0,150)),greatCircle(at(55,30),at(64,-22)),
  greatCircle(at(0,-150),at(0,150)),greatCircle(at(80,0),at(80,180))];
 for(const path of paths)for(const center of [at(0,0),at(45,90),at(90,0),at(-90,-170)])for(const zoom of [.75,1,5]){
  const frame=globeFrame(center,1280,900,zoom);
  for(const fraction of [0,.001,.02,.049,.05,.4,.5,.95,.98,.999,1]){
   const point=globeFlightPoint(path,fraction,frame),lines=globeFlightLines(path,frame,fraction);
   assert.ok([...lines.front.flat(),...lines.back.flat()].some(p=>Math.hypot(p.x-point.x,p.y-point.y)<1e-9));
   for(const [side,parts] of Object.entries(lines))for(const part of parts)for(const p of part){
    assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
    assert.ok(side==='front'?p.depth>=-1e-10:p.depth<=1e-10,'Painter layers must split at the Earth centre plane');
   }
   const before=globeFlightPoint(path,Math.max(0,fraction-1e-7),frame);
   const after=globeFlightPoint(path,Math.min(1,fraction+1e-7),frame);
   const heading=globeFlightHeading(path,fraction,frame),dx=after.x-before.x,dy=after.y-before.y;
   if(heading!==null&&Math.hypot(dx,dy)>1e-5){
    const alignment=(Math.sin(heading)*dx-Math.cos(heading)*dy)/Math.hypot(dx,dy);
    assert.ok(alignment>.9999999,`Tangent must follow actual displayed motion: ${alignment}`);
   }
  }
 }
});

test('route polyline approximates the curved ramps within 0.25 CSS px at 5×',()=>{
 const path=greatCircle(at(35,-30),at(-40,100)),frame=globeFrame(at(20,80),1280,900,5);
 const lines=globeFlightLines(path,frame),segments=Object.values(lines).flat().flatMap(line=>line.slice(1).map((p,i)=>[line[i],p]));
 function distance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
 }
 for(let i=0;i<=5000;i++){
  const p=globeFlightPoint(path,i/5000,frame);
  assert.ok(Math.min(...segments.map(([a,b])=>distance(p,a,b)))<.25);
 }
});

test('ground phases and cruise boundaries are continuous; paused save/restore reconstructs the same pose',async()=>{
 const controller=new FlightController(await loadCycleDefinition());
 controller.select('BIKF');controller.fly(0);controller.pause(0);
 const route=controller.activeForecast.phases.find(p=>p.label==='cruise').route;
 const frame=globeFrame(at(50,10),1000,700,3);
 for(const boundary of [route.startUtcMs,route.endUtcMs]){
  controller.advanceTo(boundary-1,0);
  const before=flightPlanePose(controller.view.state,controller.activeForecast,frame);
  controller.advanceTo(boundary,0);
  const after=flightPlanePose(controller.view.state,controller.activeForecast,frame);
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y)<.001,'No jump at start or landing');
 }
 // A fresh session to inspect all stationary phases in chronological order.
 const ground=new FlightController(await loadCycleDefinition());
 ground.select('BIKF');ground.fly(0);ground.pause(0);
 for(const phase of ground.activeForecast.phases.filter(p=>p.label!=='cruise')){
  ground.advanceTo((phase.route.startUtcMs+phase.route.endUtcMs)/2,0);
  const state=ground.view.state,pose=flightPlanePose(state,ground.activeForecast,frame),point=globePoint(state.position,frame);
  assert.equal(pose.x,point.x);assert.equal(pose.y,point.y);assert.equal(pose.directional,false);
 }
 ground.advanceTo(ground.session.endUtcMs,0);ground.select('CYEG');assert.equal(ground.fly(0),true);ground.pause(0);
 const refuelling=ground.activeForecast.phases.find(p=>p.label==='refuelling').route;
 ground.advanceTo((refuelling.startUtcMs+refuelling.endUtcMs)/2,0);
 const refuelPose=flightPlanePose(ground.view.state,ground.activeForecast,frame),airport=globePoint(ground.view.state.position,frame);
 assert.equal(refuelPose.x,airport.x);assert.equal(refuelPose.y,airport.y);assert.equal(refuelPose.directional,false);
 const flying=new FlightController(await loadCycleDefinition());
 flying.select('BIKF');flying.fly(0);flying.pause(0);flying.advanceTo((route.startUtcMs+route.endUtcMs)/2,0);
 const pose=flightPlanePose(flying.view.state,flying.activeForecast,frame),saved=flying.session.save();
 flying.restore(saved);
 assert.equal(flying.playing,false);assert.deepEqual(flightPlanePose(flying.view.state,flying.activeForecast,frame),pose);
 assert.equal(flying.session.save(),saved);
});
