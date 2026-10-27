// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {globeFrame,globePoint} from '../dist/core/globe.js';
import {traceCoastline} from '../web/flight/coastline.mjs';
import {readFileSync} from 'node:fs';
import {geoContains} from 'd3-geo';

function record(geometry,frame) {
 const points=[];
 let closed=0;
 traceCoastline(geometry,frame,{
  moveTo(x,y){points.push([x,y]);},
  lineTo(x,y){points.push([x,y]);},
  arc(x,y){points.push([x,y]);},
  closePath(){closed++;},
 },2);
 return {points,closed};
}

test('packaged geography retains continents, ocean and polar winding after offline simplification',()=>{
 const index=JSON.parse(readFileSync('data/geography/land-50m.json','utf8'));
 const land={type:'MultiPolygon',coordinates:index.parts.flatMap(name=>JSON.parse(readFileSync('data/geography/'+name,'utf8')))};
 for(const [point,expected] of [ [[134,-25],true],[[15,20],true],[[0,-88],true],[[-140,0],false],[[0,90],false],[[0,-90],true] ]) {
  assert.equal(geoContains(land,point),expected,JSON.stringify(point));
 }
});

test('vector coastlines share the game projection under rotated and polar cameras',()=>{
 for (const center of [{latitudeDeg:45,longitudeDeg:170},{latitudeDeg:90,longitudeDeg:0},{latitudeDeg:-90,longitudeDeg:179}]) {
  const frame=globeFrame(center,800,600,3);
  const point={latitudeDeg:center.latitudeDeg*.9,longitudeDeg:center.longitudeDeg-10};
  const expected=globePoint(point,frame);
  const actual=record({type:'Point',coordinates:[point.longitudeDeg,point.latitudeDeg]},frame).points.at(-1);
  assert.ok(Math.abs(actual[0]-expected.x)<1e-8);
  assert.ok(Math.abs(actual[1]-expected.y)<1e-8);
 }
});

test('a polygon crossing the horizon closes along the limb, with no off-sphere points',()=>{
 const frame=globeFrame({latitudeDeg:0,longitudeDeg:0},800,600);
 const polygon={type:'Polygon',coordinates:[[[60,-30],[60,30],[120,30],[120,-30],[60,-30]]]};
 const {points,closed}=record(polygon,frame);
 assert.ok(closed>0);
 assert.ok(points.length>20,'The horizon must be a sampled arc, not a closing chord');
 assert.ok(points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&Math.hypot(x-frame.cx,y-frame.cy)<=frame.radius+1e-6));
 const hidden={type:'Polygon',coordinates:[[[160,-10],[160,10],[175,10],[175,-10],[160,-10]]]};
 assert.equal(record(hidden,frame).points.length,0);
});
