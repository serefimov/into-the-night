// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {MissionSession} from '../dist/core/mission.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';

const definitionPath='data/scenarios/aircraft-transfer-v1.json';
const witnessPath='examples/aircraft-transfer/witness.json';
const definition=await loadCycleDefinition(definitionPath);
const transfer=(session,id)=>{
 assert.equal(session.transferTo(id).allowed,true);
 session.resume();
};
const fly=(session,id)=>{
 assert.equal(session.fly(id).allowed,true);
 session.resume();
};

test('the complete island circuit interleaves two profiles and preserves the parked planes',()=>{
 let s=new MissionSession(definition);
 assert.deepEqual(s.forecast('RORH').reasons.filter(r=>r==='unverified_airport'),['unverified_airport']);
 assert.equal(s.transferTo('twin-otter').allowed,true);
 s.stopAt(s.currentTimeUtc+300000);
 assert.equal(s.current().state.fleet.activeId,'dreamliner');
 assert.equal(s.forecast('RORH').allowed,false);
 assert.equal(s.transferTo('twin-otter').allowed,false);
 const mid=s.save();assert.equal(JSON.parse(mid).version,7);
 s=MissionSession.restore(mid,definition);
 assert.equal(s.save(),mid);
 s.resume();
 assert.equal(s.current().state.fleet.activeId,'twin-otter');
 assert.equal(s.current().state.fuelKg,260);
 assert.equal(s.current().state.fleet.reserveKg,150);
 assert.equal(s.forecast('ZGGG').reasons.includes('unverified_airport'),true);
 const oldTime=s.currentTimeUtc,initialFuel=s.current().state.stocks.ROAH;
 const island=s.fly('RORH');
 assert.equal(island.allowed,true);
 const refuel=island.forecast.phases.find(p=>p.label==='refuelling').route;
 s.stopAt((refuel.startUtcMs+refuel.endUtcMs)/2);
 const pumping=s.current().state;
 assert.ok(pumping.fuelKg>260&&pumping.fuelKg<island.forecast.refuelling.fuelKg);
 assert.ok(Math.abs(pumping.fuelKg-260-(initialFuel-pumping.stocks.ROAH))<1e-9);
 s=MissionSession.restore(s.save());
 s.resume();
 assert.equal(s.stateAt(oldTime-1).state.fleet.activeId,'dreamliner');
 assert.equal(s.current().state.fleet.parked[0].fuelKg,5000);
 const before=s.save();
 assert.equal(s.transferTo('dreamliner').allowed,false);
 assert.equal(s.save(),before);
 assert.equal(s.waitUntil(s.currentTimeUtc+3600000).status,'safe');
 s.resume();
 fly(s,'ROAH');
 const afterFlight=s.current().state;
 assert.ok(Math.abs(afterFlight.fuelKg-150)<1e-9);
 transfer(s,'dreamliner');
 assert.equal(s.current().state.fuelKg,5000);
 assert.deepEqual(s.current().state.stocks,afterFlight.stocks);
 assert.deepEqual(s.current().state.fleet.parked,[{id:'twin-otter',profileId:afterFlight.fleet.profileId,airportId:'ROAH',fuelKg:afterFlight.fuelKg}]);
 fly(s,'ZGGG');
 const result=s.current();
 assert.equal(result.state.status,'won');
 assert.deepEqual(result.events.filter(e=>e.kind==='transfer_completed').map(e=>[e.fromAircraftId,e.aircraftId]),
  [['dreamliner','twin-otter'],['twin-otter','dreamliner']]);
 assert.deepEqual(MissionSession.restore(s.save()).current(),result);
});

test('solar exposure and shortage stop their respective actions without advancing the session',()=>{
 const d=structuredClone(definition),early=new MissionSession(d);
 d.initial.utcMs=Math.floor(early.waitingLimit().eventUtcMs)-120000;
 const morning=new MissionSession(d),before=morning.save();
 assert.deepEqual(morning.transferTo('twin-otter').reasons,['transfer_sun']);
 assert.equal(morning.save(),before);
 d.initial.utcMs=definition.initial.utcMs; d.initial.stocks.ROAH=0;
 const dry=new MissionSession(d);transfer(dry,'twin-otter');
 assert.ok(dry.forecast('RORH').reasons.includes('fuel_stock'));
 assert.ok(dry.forecast('RORH').reasons.includes('fuel_or_reference_reserve'));
 const heavy=structuredClone(definition),p=heavy.fleet.regionalProfiles[0].profile;
 p.assumptions.zeroFuelKg=4488;
 heavy.fleet.parked[0].fuelKg=1182;
 // A synthetic short hop isolates the landing-mass constraint from solar reachability.
 const source=heavy.airports.find(a=>a.id==='ROAH');
 Object.assign(heavy.airports.find(a=>a.id==='RORH'),{
  latitudeDeg:source.latitudeDeg+.01,longitudeDeg:source.longitudeDeg
 });
 const s=new MissionSession(heavy);transfer(s,'twin-otter');
 assert.ok(s.forecast('RORH').reasons.includes('landing_mass'));
});

test('a local transfer and the acquired knowledge remain available with no flight in the current profile',async()=>{
 const d=await loadCycleDefinition('data/scenarios/chapter-one-v1.json');
 d.fleet=structuredClone(definition.fleet);
 d.fleet.parked[0].airportId='UNNT';
 d.fleet.regionalProfiles[0].airportIds=['UNNT'];
 const s=new MissionSession(d);
 for(const id of ['BIKF','CYEG','UHMA','UNNT'])fly(s,id);
 assert.equal(s.startExpedition().allowed,true);s.resume();
 transfer(s,'twin-otter');
 assert.equal(s.resolvePlanning().availability.status,'no_safe_choices');
 assert.equal(s.current().state.status,'running');
 assert.deepEqual(s.current().state.campaign.knowledgeIds,['akademgorodok']);
 transfer(s,'dreamliner');
 assert.deepEqual(MissionSession.restore(s.save()).current().state.campaign.knowledgeIds,['akademgorodok']);
 assert.equal(s.current().state.fleet.activeId,'dreamliner');
});

test('versioned route witness runs through the public CLI with both transfers, the hold and onward flight',()=>{
 const cli=spawnSync(process.execPath,['scripts/mission-cycle-cli.mjs','--definition',definitionPath,'--path',witnessPath],{encoding:'utf8'});
 assert.equal(cli.status,0,cli.stderr);
 const {state,events}=JSON.parse(cli.stdout);
 assert.equal(state.status,'won');
 assert.equal(new Date(state.utcMs).toISOString(),'2026-08-12T19:07:30.073Z');
 assert.deepEqual(events.filter(e=>e.kind==='arrived').map(e=>e.airportId),['RORH','ROAH','ZGGG']);
 assert.equal(events.filter(e=>e.kind==='transfer_completed').length,2);
 assert.equal(events.filter(e=>e.kind==='waiting_completed').length,1);
});
