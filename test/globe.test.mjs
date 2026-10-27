// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {globeFrame,globePoint,globeLocation,globeLines,globeRoute} from '../dist/core/globe.js';
import {FlightController} from '../web/flight/controller.mjs';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
const definition=await loadCycleDefinition('data/scenarios/westward-control-v2.json');
test('orthographic projection/inverse stays continuous at the date line and under polar cameras',()=>{
 for(const center of [{latitudeDeg:0,longitudeDeg:179},{latitudeDeg:90,longitudeDeg:15},{latitudeDeg:-90,longitudeDeg:-170}]){
  const frame=globeFrame(center,1000,700,1.4),point=center.latitudeDeg===0?{latitudeDeg:10,longitudeDeg:-179}:{latitudeDeg:center.latitudeDeg>0?80:-80,longitudeDeg:45};
  const projected=globePoint(point,frame);assert.equal(projected.visible,true);const back=globeLocation(projected.x,projected.y,frame);
  assert.ok(Math.abs(back.latitudeDeg-point.latitudeDeg)<1e-9);assert.ok(Math.abs(back.longitudeDeg-point.longitudeDeg)<1e-9);
  assert.equal(globeLocation(frame.cx+frame.radius+1,frame.cy,frame),null);
 }
 const frame=globeFrame({latitudeDeg:0,longitudeDeg:179},1000,700);assert.equal(globePoint({latitudeDeg:0,longitudeDeg:-1},frame).visible,false);
 assert.throws(()=>globeFrame({latitudeDeg:0,longitudeDeg:0},0,100),/viewport/);
});
test('world routes share core geometry and clip at the globe limb without a date-line jump or invented antipodal arc',()=>{
 const route=globeRoute({latitudeDeg:-37,longitudeDeg:174},{latitudeDeg:-33,longitudeDeg:-70}),frame=globeFrame({latitudeDeg:-45,longitudeDeg:-170},1000,700);
 const lines=globeLines(route,frame);assert.ok(lines.length);
 for(const line of lines)for(let i=0;i<line.length;i++){
  const p=line[i];assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(Math.hypot(p.x-frame.cx,p.y-frame.cy)<=frame.radius+1e-8);
  if(i)assert.ok(Math.hypot(p.x-line[i-1].x,p.y-line[i-1].y)<20);
 }
 assert.throws(()=>globeRoute({latitudeDeg:0,longitudeDeg:0},{latitudeDeg:0,longitudeDeg:180}),/antipodal/);
 assert.throws(()=>globeRoute({latitudeDeg:0,longitudeDeg:0},{latitudeDeg:0,longitudeDeg:0}),/Coincident/);
 assert.deepEqual(globeLines([{latitudeDeg:0,longitudeDeg:0},{latitudeDeg:0,longitudeDeg:180}],globeFrame({latitudeDeg:0,longitudeDeg:0},1000,700)),[]);
});
test('UI selection/navigation is separate from confirmation; playback pauses without changing its physical rate',()=>{
 const c=new FlightController(definition),initial=c.session.save();c.select('NZCH');assert.equal(c.choice.allowed,true);assert.equal(c.session.save(),initial);
 c.select('FACT');assert.equal(c.fly(0),false);assert.equal(c.session.save(),initial);c.select('NZCH');assert.equal(c.fly(0),true);
 const end=c.session.endUtcMs,start=definition.initial.utcMs,rate=(end-start)/45000;c.tick(10000);assert.ok(Math.abs(c.view.state.utcMs-(start+10000*rate))<.001);
 c.pause(10000);const saved=c.session.save();c.tick(20000);c.select('YPPH');assert.equal(c.session.save(),saved);
 c.play(30000);c.tick(35000);assert.ok(Math.abs(c.view.state.utcMs-(start+15000*rate))<.001);
 c.advanceTo(end,35000);assert.equal(c.view.state.airportId,'NZCH');assert.equal(c.view.state.stocks.NZCH,64000);assert.equal(c.playing,false);assert.equal(c.view.state.phase,'planning');
});
