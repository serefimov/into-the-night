import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSolarInterval } from '../dist/core/interval-search.js';

test('dark endpoints do not certify a bright middle',()=>{
 const q=ms=>0.01-((ms-1000)/1000)**2;
 const result=searchSolarInterval(0,2000,q,2,0,{maxIntervalSeconds:3600});
 assert.equal(result.status,'unsafe');assert.ok(q(result.witnessUtcMs)>=0);
 assert.ok(result.bracket[0]<=900&&result.bracket[1]>=900);
 assert.ok(result.bracket[1]-result.bracket[0]<=500);
});
test('touching q=0 without a sign change is unsafe when witnessed',()=>{
 const q=ms=>-(((ms-500)/1000)**2);
 const result=searchSolarInterval(0,1000,q,2,0);
 assert.equal(result.status,'unsafe');assert.equal(result.witnessUtcMs,500);
 assert.equal(q(0)<0&&q(1000)<0,true);
});
test('off-grid tangency and near-horizon uncertainty are not invented deaths or safety',()=>{
 const touch=ms=>-(((ms-123.456)/1000)**2);
 const result=searchSolarInterval(0,1000,touch,2,1e-8);
 assert.equal(result.status,'indeterminate');assert.equal(result.witnessUtcMs,null);
 assert.ok(result.bracket[0]<=123.456&&result.bracket[1]>=123.456);
 const near=searchSolarInterval(0,1000,()=>-1e-12,0,1e-8);
 assert.equal(near.status,'indeterminate');assert.equal(near.reason,'near_horizon');
 const pulse=searchSolarInterval(0,1000,ms=>1e-8-(((ms-123.456)/1000)**2),2,1e-8);
 assert.notEqual(pulse.status,'safe');
});
test('first event is localized without skipping earlier ambiguous intervals',()=>{
 const q=ms=>Math.sin((ms/1000-0.2)*2*Math.PI);
 const result=searchSolarInterval(0,4000,q,(2*Math.PI)**2,0,{eventToleranceSeconds:0.01});
 assert.equal(result.status,'unsafe');
 assert.ok(result.bracket[0]<=200&&result.bracket[1]>=200);
 assert.ok(result.bracket[1]-result.bracket[0]<=10);
});
test('safe certificate, initial sunlight, endpoint equality and budget exhaustion',()=>{
 assert.equal(searchSolarInterval(0,1000,()=>-1,0,1e-8).status,'safe');
 assert.equal(searchSolarInterval(0,0,()=>0,0,0).status,'unsafe');
 const endpoint=searchSolarInterval(0,1000,ms=>ms/1000-1,0,0);
 assert.equal(endpoint.status,'unsafe');assert.equal(endpoint.witnessUtcMs,1000);
 const limited=searchSolarInterval(0,100000,ms=>-1e-6+Math.sin(ms/1000)*1e-7,1,1e-8,{maxEvaluations:4});
 assert.equal(limited.status,'indeterminate');assert.equal(limited.reason,'evaluation_budget');
 assert.ok(limited.evaluations<=4);
});
test('invalid numerical settings and nonfinite callbacks are rejected',()=>{
 for(const options of [{eventToleranceSeconds:2},{eventToleranceSeconds:0},
  {maxIntervalSeconds:NaN},{maxIntervalSeconds:0},{maxEvaluations:3},{maxEvaluations:4.5}]) {
  assert.throws(()=>searchSolarInterval(0,1000,()=>-1,0,0,options),RangeError);
 }
 assert.throws(()=>searchSolarInterval(1,0,()=>-1,0,0),RangeError);
 assert.throws(()=>searchSolarInterval(0,1,()=>NaN,0,0),RangeError);
 assert.throws(()=>searchSolarInterval(1e12,1e12+1000,()=>-1,0,0,{maxIntervalSeconds:1e-12}),RangeError);
});
