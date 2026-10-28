// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastMissionWait} from '../dist/core/mission-wait.js';

const position={latitudeDeg:-80,longitudeDeg:0};
const start=Date.parse('2026-06-21T00:00:00Z');

test('standing forecast certifies the entire requested interval without changing its inputs',()=>{
 const request={position,startUtcMs:start,endUtcMs:start+86400000};
 const before=structuredClone(request),result=forecastMissionWait(request);
 assert.equal(result.status,'safe');assert.equal(result.safeUntilUtcMs,request.endUtcMs);
 assert.deepEqual(request,before);
});

test('sunrise and uncertainty cannot become permission to wait',()=>{
 const result=forecastMissionWait({position,startUtcMs:start,endUtcMs:Date.parse('2026-12-21T00:00:00Z')});
 assert.notEqual(result.status,'safe');assert.ok(result.safeUntilUtcMs< Date.parse('2026-12-21T00:00:00Z'));
 const uncertain=forecastMissionWait({position,startUtcMs:start,endUtcMs:start+86400000},{maxEvaluations:4});
 assert.equal(uncertain.status,'indeterminate');
});

test('rejects backwards, zero-length and unsupported intervals',()=>{
 for(const endUtcMs of [start,start-1,Date.parse('2041-01-01T00:00:00Z')])
  assert.throws(()=>forecastMissionWait({position,startUtcMs:start,endUtcMs}),RangeError);
});

test('a session previews waiting without changing time, fuel, stock or its save',async()=>{
 const {MissionSession}=await import('../dist/core/mission.js');
 const {loadCycleDefinition}=await import('../scripts/mission-cycle-data.mjs');
 const session=new MissionSession(await loadCycleDefinition());
 const before=session.save(),state=session.current().state;
 const forecast=session.forecastWait(state.utcMs+3600000);
 assert.equal(forecast.status,'safe');assert.equal(session.save(),before);
 assert.equal(session.fly('BIKF').allowed,true);
 assert.throws(()=>session.forecastWait(session.currentTimeUtc+3600000),/planning/);
});

test('accepted waits pause, restore, cancel and permit a separately confirmed flight',async()=>{
 const {MissionSession}=await import('../dist/core/mission.js');
 const {loadCycleDefinition}=await import('../scripts/mission-cycle-data.mjs');
 const session=new MissionSession(await loadCycleDefinition()),initial=session.current().state;
 const end=initial.utcMs+3600000;
 assert.equal(session.waitUntil(end).status,'safe');
 assert.equal(session.current().state.phase,'waiting');
 assert.equal(session.forecast('BIKF').allowed,false);
 const mid=initial.utcMs+1800000;
 session.stopAt(mid);
 assert.equal(session.current().state.fuelKg,initial.fuelKg);
 assert.deepEqual(session.current().state.stocks,initial.stocks);
 const restored=MissionSession.restore(session.save());
 assert.deepEqual(restored.current(),session.current());
 assert.equal(JSON.parse(session.save()).version,4);
 restored.cancelWait();
 assert.equal(restored.current().state.phase,'planning');
 assert.equal(restored.endUtcMs,mid);
 assert.equal(restored.current().state.flights,0);
 assert.deepEqual(MissionSession.restore(restored.save()).current(),restored.current());
 session.resume();
 assert.equal(session.current().state.utcMs,end);
 assert.equal(session.current().state.phase,'planning');
 assert.equal(session.current().state.flights,0);
 assert.equal(session.fly('BIKF').allowed,true);
 session.resume();
 assert.deepEqual(MissionSession.restore(session.save()).current(),session.current());
});

test('blocked and uncertain waits never enter the journal',async()=>{
 const {MissionSession}=await import('../dist/core/mission.js');
 const {loadCycleDefinition}=await import('../scripts/mission-cycle-data.mjs');
 const d=await loadCycleDefinition();
 for(const options of [{},{maxEvaluations:4}]){
  const session=new MissionSession(d,options),before=session.save();
  assert.notEqual(session.waitUntil(d.initial.utcMs+86400000).status,'safe');
  assert.equal(session.save(),before);
 }
});

test('cancelling immediately preserves a replayable journal without advancing UTC',async()=>{
 const {MissionSession}=await import('../dist/core/mission.js');
 const {loadCycleDefinition}=await import('../scripts/mission-cycle-data.mjs');
 const session=new MissionSession(await loadCycleDefinition()),start=session.currentTimeUtc;
 session.waitUntil(start+3600000);session.stopAt(start);session.cancelWait();
 assert.equal(session.currentTimeUtc,start);assert.equal(session.current().state.phase,'planning');
 assert.deepEqual(MissionSession.restore(session.save()).current(),session.current());
});

test('seasonal boundary is finite and a forged unsafe wait is rejected on restore',async()=>{
 const {searchStationarySunrise}=await import('../dist/core/waiting.js');
 const boundary=searchStationarySunrise(position,start);
 assert.equal(boundary.status,'found');
 assert.equal(forecastMissionWait({position,startUtcMs:start,endUtcMs:boundary.safeUntilUtcMs}).status,'safe');
 assert.notEqual(forecastMissionWait({position,startUtcMs:start,endUtcMs:boundary.eventUtcMs}).status,'safe');
 const {MissionSession}=await import('../dist/core/mission.js');
 const {saveChecksum}=await import('../dist/core/serialization.js');
 const {loadCycleDefinition}=await import('../scripts/mission-cycle-data.mjs');
 const session=new MissionSession(await loadCycleDefinition()),time=session.currentTimeUtc;
 session.waitUntil(time+3600000);
 const envelope=JSON.parse(session.save());
 envelope.payload.choices[0].waitUntil=time+86400000;
 envelope.checksum=saveChecksum(envelope.payload);
 assert.throws(()=>MissionSession.restore(JSON.stringify(envelope)),/blocked/);
});

test('the western mission still completes after explicit initial waits without creating resources',async()=>{
 const {MissionSession}=await import('../dist/core/mission.js');
 const {loadCycleDefinition}=await import('../scripts/mission-cycle-data.mjs');
 const definition=await loadCycleDefinition(),path=['BIKF','CYEG','UHMA','UNNT'];
 function finish(session){for(const id of path){assert.equal(session.fly(id).allowed,true,id);session.resume();}return session.current().state;}
 const baseline=finish(new MissionSession(definition));
 for(const minutes of [5,30,60]){
  const session=new MissionSession(definition);
  assert.equal(session.waitUntil(session.currentTimeUtc+minutes*60000).status,'safe');session.resume();
  const state=finish(session);
  assert.equal(state.status,'won');assert.equal(state.fuelKg,baseline.fuelKg);
  assert.equal(state.distanceKm,baseline.distanceKm);assert.deepEqual(state.stocks,baseline.stocks);
  assert.ok(Math.abs(state.utcMs-baseline.utcMs-minutes*60000)<.001);
  assert.deepEqual(MissionSession.restore(session.save()).current(),session.current());
 }
});
