// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MissionSession,CAMPAIGN_MODEL} from '../dist/core/mission.js';
import {forecastChapterOne} from '../dist/core/mission-ground.js';
import {solarExposure} from '../dist/core/solar.js';
import {saveChecksum} from '../dist/core/serialization.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';
import {FlightController} from '../web/flight/controller.mjs';
const definition=await loadCycleDefinition('data/scenarios/chapter-one-v1.json'),path=['BIKF','CYEG','UHMA','UNNT'];
const report=JSON.parse(await readFile('docs/chapter-one/report.json','utf8'));
function atAirport(d=definition){const s=new MissionSession(d);for(const to of path){assert.equal(s.fly(to).allowed,true);s.resume();}return s;}

test('campaign witness needs westward flights, real ground collection, return and inherited onward fuel',()=>{
 const s=atAirport(),arrived=s.current().state;
 assert.equal(arrived.status,'running');assert.deepEqual(arrived.campaign.knowledgeIds,[]);assert.equal(arrived.campaign.chapterOneCompleted,false);
 const forecast=s.forecastExpedition().forecast;assert.equal(forecast.endUtcMs-arrived.utcMs,14400000);
 assert.equal(forecast.solar.status,'safe');assert.equal(forecast.parkedSolar.status,'safe');assert.notEqual(forecast.siteSunriseUtcMs,forecast.airportSunriseUtcMs);
 s.startExpedition();s.stopAt(forecast.acquiredUtcMs-.001);
 assert.deepEqual(s.current().state.campaign.knowledgeIds,[]);
 s.stopAt(forecast.acquiredUtcMs);
 assert.deepEqual(s.current().state.campaign.knowledgeIds,['akademgorodok']);assert.equal(s.current().state.campaign.chapterOneCompleted,false);
 s.resume();const returned=s.current().state;
 assert.equal(returned.utcMs,report.witness.returned.utcMs);assert.equal(returned.campaign.objective,'tsukuba');assert.equal(returned.status,'running');
 assert.equal(returned.fuelKg,arrived.fuelKg);assert.deepEqual(returned.stocks,arrived.stocks);
 assert.equal(s.startExpedition().allowed,false);
 const onward=s.fly('UACC');assert.equal(onward.allowed,true);assert.equal(onward.forecast.refuelling.airportId,'UNNT');s.resume();
 assert.equal(s.current().state.utcMs,report.witness.final.utcMs);assert.deepEqual(s.current().state.stocks.UNNT,report.witness.final.stockChangesKg.UNNT);
 assert.equal(s.current().events.filter(e=>e.kind==='knowledge_acquired').length,1);assert.equal(s.current().events.filter(e=>e.kind==='chapter_completed').length,1);
 assert.equal(s.resume().newEvents.length,0);
});

test('every ground phase resumes at its real position with a parked plane, paused playback and no duplicated reward or resources',()=>{
 const s=atAirport(),initial=s.current().state;const c=new FlightController(definition);c.restore(s.save());
 c.startExpedition(0);const start=initial.utcMs,end=c.session.endUtcMs;
 for(const [offset,phase,knowledge] of [[2700000,'ground_outbound',[]],[7200000,'ground_acquisition',[]],[10800000,'ground_return',['akademgorodok']]]){
  c.advanceTo(start+offset,0);c.pause(0);const before=c.session.current(),serialized=c.session.save();
  assert.equal(before.state.phase,phase);assert.deepEqual(before.state.campaign.knowledgeIds,knowledge);
  assert.notDeepEqual(before.state.position,before.state.aircraft.position);assert.equal(before.state.aircraft.airportId,'UNNT');assert.equal(before.state.airportId,null);
  assert.equal(solarExposure(before.state.position,before.state.utcMs).safe,true);
  const restored=new FlightController(definition);restored.restore(serialized);assert.equal(restored.playing,false);restored.tick(999999);
  assert.equal(restored.session.save(),serialized);
  assert.equal(restored.session.fly('UACC').allowed,false);assert.equal(restored.session.save(),serialized);
  assert.throws(()=>restored.session.waitUntil(end+1000),/not planning/);
  restored.advanceTo(end,0);assert.equal(restored.view.state.campaign.chapterOneCompleted,true);
  assert.equal(restored.view.state.fuelKg,initial.fuelKg);assert.deepEqual(restored.view.state.stocks,initial.stocks);
  assert.deepEqual(restored.view.state.campaign.knowledgeIds,['akademgorodok']);
 }
});

test('late airport arrival and sunrise during road travel are refused without advancing UTC, stocks or knowledge',async()=>{
 const old=await loadCycleDefinition(),late=atAirport({...old,chapterOne:definition.chapterOne});
 const before=late.save(),choice=late.startExpedition();assert.equal(choice.allowed,false);assert.equal(choice.forecast.solar.status,'unsafe');
 assert.equal(choice.forecast.solar.stage,'ground_return');assert.ok(choice.forecast.solar.witnessUtcMs<choice.forecast.endUtcMs);
 assert.equal(solarExposure(choice.forecast.solar.position,choice.forecast.solar.witnessUtcMs).safe,false);
 assert.equal(late.save(),before);
 const short=forecastChapterOne({...definition.chapterOne,outboundSeconds:3600,returnSeconds:3600},late.currentTimeUtc);
 assert.equal(short.allowed,true);assert.equal(report.historical.budgets[0].onwardSafeIds.length,0);
 assert.deepEqual(report.budgets.map(b=>[b.hours,b.ground.allowed,b.onwardSafeIds.length]),[[3,true,138],[4,true,8],[5,true,0]]);
 assert.equal(report.direct.solar.status,'unsafe');assert.equal(report.evidence.westwardAroundWorld,true);
});

test('the final UTC is checked and numerical uncertainty never authorizes an expedition',()=>{
 const s=atAirport(),f=s.forecastExpedition().forecast;
 const late=forecastChapterOne(definition.chapterOne,f.airportSunriseUtcMs-14400000);
 assert.equal(solarExposure(definition.chapterOne.inbound.at(-1),late.endUtcMs).safe,false);assert.equal(late.allowed,false);
 const uncertain=new MissionSession(definition,{maxEvaluations:4});
 // Ground budget exhaustion is independent of whether tiny-budget flight forecasts can be accepted.
 const limited=forecastChapterOne(definition.chapterOne,s.currentTimeUtc,{maxEvaluations:4});
 assert.equal(limited.allowed,false);assert.equal(limited.solar.status,'indeterminate');assert.equal(uncertain.current().state.campaign.knowledgeIds.length,0);
});

test('campaign saves version their model and reject duplicate operations, forged knowledge and incompatible old parties',async()=>{
 const s=atAirport();s.startExpedition();s.stopAt(s.currentTimeUtc+10800000);const save=s.save(),e=JSON.parse(save);
 assert.equal(e.version,6);assert.equal(e.payload.mode,CAMPAIGN_MODEL.mode);assert.equal(e.payload.eventVersion,4);
 assert.deepEqual(MissionSession.restore(save,definition).current(),s.current());
 function corrupt(edit){const x=JSON.parse(save);edit(x);x.checksum=saveChecksum(x.payload);return JSON.stringify(x);}
 assert.throws(()=>MissionSession.restore(corrupt(x=>x.payload.snapshot.state.campaign.knowledgeIds.push('akademgorodok'))),/snapshot/);
 assert.throws(()=>MissionSession.restore(corrupt(x=>{x.payload.choices.push({expedition:true});x.payload.cursorUtcMs=x.payload.snapshot.state.utcMs;})),/expedition is blocked/);
 assert.throws(()=>MissionSession.restore(corrupt(x=>x.version=5)),/version/);
 const old=new MissionSession(await loadCycleDefinition());assert.equal(JSON.parse(old.save()).version,3);assert.throws(()=>MissionSession.restore(old.save(),definition),/definition differs/);
 assert.equal(MissionSession.restore(old.save()).definition.scenarioId,'academic-westward');
 const invalid=structuredClone(definition);invalid.chapterOne.outboundSeconds=0;assert.throws(()=>new MissionSession(invalid),/durations/);
});
