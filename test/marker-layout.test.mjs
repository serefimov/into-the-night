// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutAirportMarkers} from '../web/flight/marker-layout.mjs';
import {globeFrame,globePoint} from '../dist/core/globe.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
const definition=await loadCycleDefinition();
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
function layout(center,zoom,width,height,extra={}){const frame=globeFrame(center,width,height,zoom);return layoutAirportMarkers({airports:definition.airports,frame,width,height,zoom,priorityIds:['SCEL','FACT','NZCH'],...extra});}
test('overview budgets scale to viewport; groups retain every visible airport and do not depend on forecast completion',()=>{
 for(const [w,h] of [[390,350],[940,814]])for(const center of [{latitudeDeg:-42,longitudeDeg:-140},{latitudeDeg:50,longitudeDeg:10}]){
  const before=JSON.stringify(definition),r=layout(center,1,w,h),ids=r.rows.flatMap(p=>p.group.map(a=>a.id));
  assert.ok(r.rows.length<=r.budget);assert.equal(ids.length,r.projectedCount);assert.equal(new Set(ids).size,ids.length);assert.ok(r.rows.length<=24);
  assert.equal(r.rows.filter(p=>p.label&&!p.priority).length,0);assert.equal(JSON.stringify(definition),before);
  assert.deepEqual(layout(center,1,w,h),r);
 }
 assert.ok(layout({latitudeDeg:50,longitudeDeg:10},1,390,350).budget<layout({latitudeDeg:50,longitudeDeg:10},1,940,814).budget);
});
test('dense detail groups keep distinct choices, priorities and labels clear of controls',()=>{
 const center={latitudeDeg:50,longitudeDeg:10},width=940,height=814,frame=globeFrame(center,width,height,5),obstacles=[{left:0,top:0,right:250,bottom:100},{left:0,top:650,right:90,bottom:814}],airports=definition.airports;
 const priority=airports.filter(a=>{const p=globePoint(a,frame);return p.depth>.1&&p.x>100&&p.x<width-100&&p.y>100&&p.y<height-100;}).slice(0,3).map(a=>a.id);
 const r=layoutAirportMarkers({airports,frame,width,height,zoom:5,priorityIds:priority,obstacles}),ids=r.rows.flatMap(p=>p.group.map(a=>a.id));
 assert.equal(ids.length,r.projectedCount);assert.equal(new Set(ids).size,ids.length);
 for(const id of priority)assert.ok(r.rows.find(p=>p.id===id)?.priority);
 for(const row of r.rows){const hit={left:row.x-22,right:row.x+22,top:row.y-22,bottom:row.y+22};assert.ok(!obstacles.some(o=>intersects(hit,o)));if(row.label)assert.ok(!obstacles.some(o=>intersects(row.label,o)));}
 const labels=r.rows.filter(p=>p.label).map(p=>p.label);for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)assert.equal(intersects(labels[i],labels[j]),false);
 assert.ok(r.rows.length<=r.budget);assert.ok(r.detail);
});
test('mobile priority names reserve space before ordinary airport groups and avoid the aircraft glyph',()=>{
 const width=390,height=369,frame=globeFrame({latitudeDeg:-42,longitudeDeg:-140},width,height),labels={SCEL:'Сантьяго',NZCH:'Крайстчерч',FACT:'Кейптаун'},airports=definition.airports.map(a=>({...a,label:labels[a.id]??a.name})),p=globePoint(airports.find(a=>a.id==='SCEL'),frame);
 const r=layoutAirportMarkers({airports,frame,width,height,zoom:1,priorityIds:['NZCH','SCEL','FACT'],obstacles:[{left:7,top:181,right:61,bottom:331},{left:11,top:8,right:111,bottom:51},{left:11,top:323,right:270,bottom:341},{left:11,top:341,right:380,bottom:359}],plane:{...p,y:p.y-13}});
 for(const id of ['SCEL','NZCH']){const row=r.rows.find(r=>r.id===id);assert.ok(row.label,id);assert.ok(Math.abs(row.label.right-row.label.left-125)<1e-9);for(const other of r.rows)if(other!==row)assert.ok(!intersects(row.label,{left:other.x-17,right:other.x+17,top:other.y-17,bottom:other.y+17}));}
});
test('focusing any airport reveals it as a selectable member, including blocked/unverified and coincident neighbors',()=>{
 // All real catalog entries, even those absent from the overview, remain discoverable.
 for(const airport of definition.airports){const r=layout(airport,5,390,350,{priorityIds:[]});assert.ok(r.rows.some(p=>p.group.some(a=>a.id===airport.id)),airport.id);}
 const airports=Array.from({length:30},(_,i)=>({id:'overlap-'+i,latitudeDeg:0,longitudeDeg:0})),r=layoutAirportMarkers({airports,frame:globeFrame(airports[0],390,350,5),width:390,height:350,zoom:5,priorityIds:['overlap-20']});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].id,'overlap-20');assert.equal(r.rows[0].group.length,30);assert.equal(r.rows[0].cluster,true);
});
