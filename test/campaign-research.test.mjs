// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCampaignData} from '../scripts/campaign-data.mjs';
import {validateCatalog} from '../scripts/mission-data.mjs';
import {campaignState,CAMPAIGN_SETTINGS,researchCampaign,loadCampaignReport,certifyPolarDay} from '../scripts/campaign-research.mjs';
import {loadDetourReport} from '../scripts/campaign-detours.mjs';
import {forecastResearchFlight,executeResearchFlight} from '../dist/core/mission-research.js';
const data=await loadCampaignData(),world={profile:data.profile,airports:data.airports,targetId:'UNNT',targetCompletion:'after_turnaround'};
const initial=campaignState(data,Date.parse(CAMPAIGN_SETTINGS.selectedDeparture));

test('expanded pinned catalogue preserves source coordinates and does not approve unknown surfaces or Svalbard for B788',()=>{
 const check=validateCatalog(data.catalog,data.airports,data.fuel,data.profile);assert.equal(check.airports,1183);assert.equal(check.screenedCandidates,655);
 const n=data.airports.find(a=>a.id==='UNNT'),s=data.airports.find(a=>a.id==='ENSB');
 assert.equal(n.latitudeDeg,55.019756);assert.equal(n.longitudeDeg,82.618675);assert.equal(s.suitability.status,'unverified');assert.equal(s.runways[0].lengthM,2318.918);
 assert.equal(data.airports.find(a=>a.id==='LCEN').runways[0].surface,'');
 const airports=structuredClone(data.airports);airports.find(a=>a.id==='LCEN').suitability.status='screened-candidate';
 assert.throws(()=>validateCatalog(data.catalog,airports,data.fuel,data.profile),/screening contradiction/);
});

test('chapter target includes mandatory maximal turnaround, conserves finite fuel and uses the execution transition',()=>{
 const before=structuredClone(initial),f=forecastResearchFlight(world,initial,'UNNT',CAMPAIGN_SETTINGS.refinedSolar);
 assert.equal(f.allowed,true);assert.equal(f.solarScope,'automatic_turnaround');assert.deepEqual(f,executeResearchFlight(world,initial,'UNNT',CAMPAIGN_SETTINGS.refinedSolar));
 assert.deepEqual(initial,before);assert.ok(f.endUtcMs>f.arrivalUtcMs);assert.equal(f.next.won,true);
 const transferred=initial.stocks.UNNT-f.next.stocks.UNNT;assert.ok(Math.abs(transferred-f.refuelling.transferKg)<1e-8);
 assert.ok(Math.abs(initial.fuelKg+transferred-f.flight.burnKg-f.next.fuelKg)<1e-8);assert.equal(f.next.fuelKg,100964.8);
 assert.throws(()=>forecastResearchFlight({...world,targetCompletion:'unknown'},initial,'UNNT'),/target completion/);
});

test('a safe target landing cannot hide sunrise during mandatory ground refuelling of a continuing chapter',()=>{
 const state=campaignState(data,Date.parse('2026-08-20T17:58:00Z')),before=structuredClone(state);
 const arrival=forecastResearchFlight({...world,targetCompletion:'arrival'},state,'UNNT',CAMPAIGN_SETTINGS.refinedSolar);
 const turn=forecastResearchFlight(world,state,'UNNT',CAMPAIGN_SETTINGS.refinedSolar);
 assert.equal(arrival.allowed,true);assert.equal(arrival.endUtcMs,arrival.arrivalUtcMs);
 assert.equal(turn.allowed,false);assert.equal(turn.next,null);assert.equal(turn.solar.status,'unsafe');assert.equal(turn.solar.phase,'refuelling');assert.deepEqual(state,before);
});

test('numerical campaign report replays the first flight, certifies full polar day and exposes the continuation dead end',async()=>{
 const report=await researchCampaign();assert.deepEqual(report,await loadCampaignReport());
 assert.deepEqual((await loadDetourReport()).inputs,report.inputs);
 assert.equal(report.witness.solar.status,'safe');assert.ok(report.witness.postTurnaroundNightSeconds>14*60&&report.witness.postTurnaroundNightSeconds<16*60);
 assert.equal(report.continuation.testedDestinations,654);assert.deepEqual(report.continuation.allowed,[]);
 assert.ok(report.dates.every(d=>d.originalOneHourStart.firstMoveRuledOutWithinCatalog));
 const s=data.airports.find(a=>a.id==='ENSB');assert.equal(certifyPolarDay(s,Date.parse('2026-08-20T00:00:00Z')).status,'safe');
 assert.equal(certifyPolarDay(s,Date.parse('2026-08-22T00:00:00Z')).status,'unsafe');
 assert.equal(report.result.fullCampaignCertified,false);assert.equal(report.result.firstChapterPlayableApproved,false);
 assert.ok(report.southernProbes.some(p=>p.to==='SBGR'&&p.allowed));
});
