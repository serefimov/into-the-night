// SPDX-License-Identifier: GPL-3.0-only
import {MissionSession} from '../../dist/core/mission.js';
const FLIGHT_PLAYBACK_MS = 22500;
export class FlightController {
 constructor(definition, options = {}) {
  this.options = Object.freeze({...options});
  this.#replaceSession(new MissionSession(definition, options));
 }

 #replaceSession(session) {
  const history = session.acceptedFlights;
  const view = session.current();
  const active = view.state.activeFlight ? history.at(-1) : null;

  this.session = session;
  this.playing = false;
  this.selectedId = active?.toId ?? session.waitingDestinationId ?? null;
  this.activeForecast = active?.forecast ?? null;
  this.tracks = history.map(flight => flight.forecast.phases.find(p => p.label === 'cruise').route.path);
  this.anchorUtc = view.state.utcMs;
  this.anchorReal = 0;
  this.rate = view.state.activeWait ? (session.endUtcMs-view.state.activeWait.startUtcMs)/FLIGHT_PLAYBACK_MS : active ? (session.endUtcMs - view.state.activeFlight.startUtcMs) / FLIGHT_PLAYBACK_MS : 1;
  this.refresh();
 }

 restore(serialized) {
  // Validate before replacing any part of the live party, including playback.
  const session = MissionSession.restore(serialized, this.session.definition);
  this.#replaceSession(session);
 }

 restart() {
  this.#replaceSession(new MissionSession(this.session.definition, this.options));
 }
 waitForDeparture(startUtcMs,now=performance.now()) {
  if(!this.selectedId||!this.session.waitForDeparture(this.selectedId,startUtcMs))return false;
  this.rate=(this.session.endUtcMs-this.session.currentTimeUtc)/FLIGHT_PLAYBACK_MS;
  this.play(now);this.refresh();return true;
 }
 waitUntil(utcMs,now=performance.now()) {
  const result=this.session.waitUntil(utcMs);
  if(result.status==='safe'){this.rate=(this.session.endUtcMs-this.session.currentTimeUtc)/FLIGHT_PLAYBACK_MS;this.play(now);}
  this.refresh();return result;
 }
 cancelWait(now=performance.now()) {
  this.pause(now);if(this.view.state.phase==='waiting')this.session.cancelWait();this.refresh();
 }
 resolvePlanning(){const result=this.session.resolvePlanning();this.refresh();return result;}
 select(id){this.selectedId=id;this.refresh();}
 refresh(){this.view=this.session.current();this.choice=this.selectedId?this.session.forecast(this.selectedId):null;}
 fly(now=performance.now()) {
  if(!this.selectedId)return false;const choice=this.session.fly(this.selectedId);if(!choice.allowed){this.refresh();return false;}
  this.activeForecast=choice.forecast;const cruise=choice.forecast.phases.find(p=>p.label==='cruise');this.tracks.push(cruise.route.path);
  this.rate=(this.session.endUtcMs-this.session.currentTimeUtc)/FLIGHT_PLAYBACK_MS;this.play(now);this.refresh();return true;
 }
 play(now=performance.now()){if(this.session.currentTimeUtc>=this.session.endUtcMs)return;this.anchorUtc=this.session.currentTimeUtc;this.anchorReal=now;this.playing=true;}
 pause(now=performance.now()){if(this.playing)this.tick(now);this.playing=false;}
 tick(now){if(!this.playing)return false;this.advanceTo(Math.max(this.session.currentTimeUtc,this.anchorUtc+Math.max(0,now-this.anchorReal)*this.rate),now,false);return true;}
 advanceTo(utcMs,now=performance.now(),reanchor=true){this.session.stopAt(utcMs);if(reanchor){this.anchorUtc=this.session.currentTimeUtc;this.anchorReal=now;}if(this.session.currentTimeUtc===this.session.endUtcMs){this.playing=false;this.activeForecast=null;}this.refresh();}
}
