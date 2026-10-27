// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {FlightController} from '../web/flight/controller.mjs';
import {loadCycleDefinition} from '../scripts/mission-cycle-data.mjs';

const definition = await loadCycleDefinition();

function fly(controller, destination) {
 controller.select(destination);
 assert.equal(controller.fly(0), true);
 controller.pause(0);
}

function halfwayThrough(controller, phase) {
 const route = controller.activeForecast.phases.find(item => item.label === phase).route;
 controller.advanceTo((route.startUtcMs + route.endUtcMs) / 2, 0);
}

for (const phase of ['cruise', 'refuelling']) {
 test(`restoring ${phase} preserves the accepted route, finite stocks and playback rate`, () => {
  const original = new FlightController(definition);
  fly(original, 'BIKF');
  if (phase === 'refuelling') {
   original.advanceTo(original.session.endUtcMs, 0);
   fly(original, 'CYEG');
  }
  halfwayThrough(original, phase);

  const saved = original.session.save();
  const restored = new FlightController(definition);
  restored.restore(saved);

  assert.equal(restored.session.save(), saved);
  assert.deepEqual(restored.view, original.view);
  assert.deepEqual(restored.tracks, original.tracks);
  assert.deepEqual(restored.activeForecast, original.activeForecast);
  assert.equal(restored.selectedId, original.view.state.activeFlight.toId);
  assert.equal(restored.playing, false);
  assert.equal(restored.rate, original.rate);

  restored.play(0);
  restored.tick(1000);
  original.advanceTo(restored.view.state.utcMs, 1000);
  assert.deepEqual(restored.view, original.view);
  restored.advanceTo(restored.session.endUtcMs, 1000);
  original.advanceTo(original.session.endUtcMs, 1000);
  assert.deepEqual(restored.view, original.view, 'Restoring must not transfer fuel twice');
 });
}

test('invalid or incompatible restore leaves a playing party and its selection intact', () => {
 const controller = new FlightController(definition);
 fly(controller, 'BIKF');
 halfwayThrough(controller, 'cruise');
 controller.play(0);
 const before = {
  save: controller.session.save(),
  selected: controller.selectedId,
  forecast: structuredClone(controller.activeForecast),
  tracks: structuredClone(controller.tracks),
  rate: controller.rate,
  anchor: controller.anchorUtc,
 };
 const other = structuredClone(definition);
 other.seed = 'another-mission';
 const incompatible = new FlightController(other).session.save();
 const damaged = JSON.parse(before.save);
 damaged.payload.snapshot.state.fuelKg++;

 for (const invalid of ['{', '{"format":"into-the-night-mission","version":2}', JSON.stringify(damaged), incompatible]) {
  assert.throws(() => controller.restore(invalid));
  assert.equal(controller.session.save(), before.save);
  assert.equal(controller.selectedId, before.selected);
  assert.deepEqual(controller.activeForecast, before.forecast);
  assert.deepEqual(controller.tracks, before.tracks);
  assert.equal(controller.rate, before.rate);
  assert.equal(controller.anchorUtc, before.anchor);
  assert.equal(controller.playing, true);
 }
});

test('restoring a finished mission preserves its result and restart begins a genuinely new party', () => {
 const controller = new FlightController(definition);
 for (const destination of ['BIKF', 'CYEG', 'UHMA', 'UNNT']) {
  fly(controller, destination);
  controller.advanceTo(controller.session.endUtcMs, 0);
 }
 const saved = controller.session.save();
 const restored = new FlightController(definition);
 restored.restore(saved);
 assert.equal(restored.session.save(), saved);
 assert.equal(restored.view.state.status, 'won');
 assert.equal(restored.activeForecast, null);
 assert.deepEqual(restored.tracks, controller.tracks);
 restored.play(0);
 assert.equal(restored.playing, false);

 restored.restart();
 assert.equal(restored.session.save(), new FlightController(definition).session.save());
 assert.deepEqual(restored.tracks, []);
 assert.equal(restored.selectedId, null);
});

test('accepted history is isolated from callers and excludes merely selected destinations', () => {
 const controller = new FlightController(definition);
 controller.select('BIKF');
 assert.deepEqual(controller.session.acceptedFlights, []);
 fly(controller, 'BIKF');
 const before = controller.session.save();
 const history = controller.session.acceptedFlights;
 assert.equal(history[0].fromId, 'ULLI');
 assert.equal(history[0].toId, 'BIKF');
 history[0].forecast.next.fuelKg = 0;
 history.splice(0);
 assert.equal(controller.session.save(), before);
 assert.equal(controller.session.acceptedFlights.length, 1);
});
