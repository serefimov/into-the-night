// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {MissionSession} from '../dist/core/mission.js';
import {saveChecksum} from '../dist/core/serialization.js';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';

const session = new MissionSession(await loadCycleDefinition());
const flight = session.fly('BIKF').forecast;
const cruise = flight.phases.find(phase => phase.label === 'cruise').route;
session.stopAt((cruise.startUtcMs + cruise.endUtcMs) / 2);
const saved = session.save();

function changedSnapshot(change) {
 const envelope = JSON.parse(saved);
 change(envelope.payload.snapshot);
 envelope.checksum = saveChecksum(envelope.payload);
 return JSON.stringify(envelope);
}

test('portable saves accept final floating-point digits of physical metrics without changing recomputation', () => {
 const portable = changedSnapshot(({state}) => {
  state.fuelKg += 4e-12;
  state.distanceKm += 2e-13;
  state.position.longitudeDeg += 4e-15;
  state.stocks.ULLI += 1e-11;
 });
 assert.deepEqual(MissionSession.restore(portable).current(), session.current());
});

test('portable snapshot validation still rejects changed UTC, events, results and meaningful resource differences', () => {
 const corruptions = [
  ({state}) => state.utcMs += .001,
  ({state}) => state.fuelKg += 1e-6,
  ({state}) => state.distanceKm += 1e-6,
  ({state}) => state.stocks.ULLI += 1e-6,
  ({state}) => state.position.longitudeDeg += 1e-7,
  ({state}) => state.status = 'won',
  ({state}) => state.stocks.extra = 0,
  snapshot => snapshot.events[0].sequence++,
 ];
 for (const corrupt of corruptions) {
  assert.throws(() => MissionSession.restore(changedSnapshot(corrupt)), /snapshot/);
 }
 assert.equal(session.save(), saved);
});
