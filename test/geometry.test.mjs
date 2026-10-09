import test from 'node:test';
import assert from 'node:assert/strict';
import { greatCircle, greatCircleNormal, greatCirclePosition, SOLAR_MODEL } from '../dist/core/index.js';
const position=(latitudeDeg,longitudeDeg)=>({latitudeDeg,longitudeDeg});
const close=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);

test('great-circle distance and interpolation agree with analytical equatorial arc',()=>{
 const path=greatCircle(position(0,0),position(0,90));
 close(path.angleRad,Math.PI/2);
 close(path.distanceKm,SOLAR_MODEL.earthRadiusKm*Math.PI/2,1e-8);
 for(const fraction of [0,0.1,0.5,0.9,1]) {
  const point=greatCirclePosition(path,fraction);
  close(point.latitudeDeg,0);close(point.longitudeDeg,90*fraction);
  close(Math.hypot(...greatCircleNormal(path,fraction)),1);
 }
});

test('shortest arc crosses date line, not Greenwich',()=>{
 const path=greatCircle(position(0,179),position(0,-179));
 close(path.angleRad,2*Math.PI/180);
 const mid=greatCirclePosition(path,0.5);
 close(Math.abs(mid.longitudeDeg),180);close(mid.latitudeDeg,0);
});

test('polar trajectory remains finite and follows the same arc when reversed',()=>{
 const path=greatCircle(position(80,0),position(80,180));
 const reverse=greatCircle(position(80,180),position(80,0));
 close(path.angleRad,20*Math.PI/180);
 close(greatCirclePosition(path,0.5).latitudeDeg,90);
 for(const fraction of [0,0.25,0.499999,0.5,0.500001,0.75,1]) {
  const a=greatCircleNormal(path,fraction),b=greatCircleNormal(reverse,1-fraction);
  for(let i=0;i<3;i++)close(a[i],b[i]);
  const point=greatCirclePosition(path,fraction);
  assert.ok(Number.isFinite(point.latitudeDeg)&&Number.isFinite(point.longitudeDeg));
 }
});

test('coincident/near-antipodal/invalid coordinates are rejected before simulation',()=>{
 for(const [a,b] of [[position(0,0),position(0,0)],
  [position(0,-180),position(0,180)],[position(90,-90),position(90,90)],
  [position(0,0),position(0,180)],[position(0,0),position(0,179.999999)]]) {
  assert.throws(()=>greatCircle(a,b),RangeError);
 }
 assert.throws(()=>greatCircle(position(NaN,0),position(0,90)),RangeError);
 const short=greatCircle(position(0,0),position(0,0.000001));
 assert.ok(short.distanceKm>0);
 for(const fraction of [-0.01,1.01,NaN,Infinity])assert.throws(()=>greatCirclePosition(short,fraction),RangeError);
});
