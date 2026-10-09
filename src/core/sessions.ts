import { tracePlan, visibleState, SIMULATION_CONFIG } from './simulation.js';
import type { Action, Event, ExecutionTrace, Outcome, PublicState, State, World } from './simulation.js';
import { routePhasePosition } from './route.js';
import type { SearchOptions } from './interval-search.js';
import { validateUtcMs } from './time.js';
import type { StandingForecast } from './waiting.js';

export interface TimelineView {
  outcome: 'paused' | Outcome;
  requestedUtcMs: number;
  state: PublicState;
  /** Complete historical journal at this time; read-only views do not dispatch events. */
  events: Event[];
  waiting: StandingForecast | null;
}
export interface SessionAdvance extends TimelineView { newEvents: Event[] }
export type SessionOptions = SearchOptions & { confirmRisk?: boolean };
export class SessionError extends Error {
  constructor(readonly outcome: Outcome, message: string) { super(message); this.name = 'SessionError'; }
}
export function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])) as T;
  return value;
}
function stateFromTrace(origin: State, trace: ExecutionTrace, requestedUtcMs: number): State {
  validateUtcMs(requestedUtcMs);
  if (requestedUtcMs < origin.currentTimeUtc) throw new RangeError('UTC precedes this plan.');
  const end = trace.result.state.currentTimeUtc;
  const time = Math.min(requestedUtcMs, end);
  let state = copy(origin);
  for (const entry of trace.entries) {
    if (entry.kind === 'checkpoint') {
      if (entry.state.currentTimeUtc <= time) state = copy(entry.state);
      continue;
    }
    const lo = entry.before.currentTimeUtc, hi = entry.after.currentTimeUtc;
    if (time < lo) continue;
    if (time >= hi) { state = copy(entry.after); continue; }
    const fraction = (time - lo) / (hi - lo);
    state = copy(entry.before);
    const linear = (a: number, b: number) => a + (b - a) * fraction;
    state.currentTimeUtc = time;
    state.aircraft.position = routePhasePosition(entry.phase, time);
    state.aircraft.fuelKg = linear(entry.before.aircraft.fuelKg, entry.after.aircraft.fuelKg);
    state.aircraft.foodPersonHours = linear(entry.before.aircraft.foodPersonHours, entry.after.aircraft.foodPersonHours);
    for (const id of Object.keys(state.stocks)) {
      state.stocks[id]!.fuelKg = linear(entry.before.stocks[id]!.fuelKg, entry.after.stocks[id]!.fuelKg);
      state.stocks[id]!.foodPersonHours = linear(entry.before.stocks[id]!.foodPersonHours, entry.after.stocks[id]!.foodPersonHours);
    }
    state.distanceKm = linear(entry.before.distanceKm, entry.after.distanceKm);
    if (state.activeAction) {
      const after = entry.after.activeAction!;
      state.activeAction.elapsedSeconds = (time - state.activeAction.startedUtcMs) / 1000;
      state.activeAction.transferred.fuelKg = linear(state.activeAction.transferred.fuelKg, after.transferred.fuelKg);
      state.activeAction.transferred.foodPersonHours = linear(state.activeAction.transferred.foodPersonHours, after.transferred.foodPersonHours);
    }
    for (const event of trace.result.events.slice(entry.eventsBefore, entry.eventsAfter)) {
      if (event.utcMs <= time && event.kind === 'achievement') state.achievements.push(event.detail.days as number);
    }
  }
  return state;
}
function eventsAt(trace: ExecutionTrace, utcMs: number): Event[] { return copy(trace.result.events.filter(event => event.utcMs <= utcMs)); }
function publicView(world: World, origin: State, trace: ExecutionTrace, time: number, known: readonly string[]): TimelineView {
  const state = stateFromTrace(origin, trace, time);
  // A future landing is not an actual discovery. Never project its exact warehouse before stopAt commits it.
  state.discovered = state.discovered.filter(id => known.includes(id));
  const events = eventsAt(trace, state.currentTimeUtc).filter(event => event.kind !== 'airport_discovered' || known.includes(event.detail.airportId as string));
  return { outcome: state.currentTimeUtc === trace.result.state.currentTimeUtc ? trace.result.outcome : 'paused', requestedUtcMs: time,
    state: visibleState(world, state), events,
    waiting: trace.result.waiting && trace.result.waiting.sunrise.startUtcMs <= state.currentTimeUtc ? copy(trace.result.waiting) : null };
}
export class ForecastTimeline {
  #world: World; #origin: State; #trace: ExecutionTrace;
  constructor(world: World, state: State, actions: readonly Action[], options: SearchOptions = {}) {
    this.#world = copy(world); this.#origin = copy(state);
    this.#trace = tracePlan(this.#world, this.#origin, copy(actions), copy(options));
    if (this.#trace.result.outcome === 'validation_error') throw new SessionError('validation_error', this.#trace.result.message!);
  }
  get endUtcMs(): number { return this.#trace.result.state.currentTimeUtc; }
  stateAt(utcMs: number): TimelineView { return publicView(this.#world, this.#origin, this.#trace, utcMs, this.#origin.discovered); }
}
export interface SavePayload {
  schemaVersion: 3; simulationVersion: string; configVersion: number;
  scenarioId: string; scenarioVersion: number; seed: string;
  world: World; origin: State; actions: readonly Action[]; options: SessionOptions;
  cursorUtcMs: number; consumedEvents: number; snapshot: State; journal: Event[];
}
export class SimulationSession {
  #world: World; #origin: State; #actions: readonly Action[]; #options: SessionOptions;
  #trace: ExecutionTrace; #cursor: number; #consumedEvents = 0;
  constructor(world: World, state: State, actions: readonly Action[], options: SessionOptions = {}) {
    this.#world = copy(world); this.#origin = copy(state); this.#actions = copy(actions); this.#options = copy(options);
    this.#trace = tracePlan(this.#world, this.#origin, this.#actions, this.#options, 'execute');
    if (['validation_error','needs_refinement','risk_confirmation_required'].includes(this.#trace.result.outcome)) {
      throw new SessionError(this.#trace.result.outcome, this.#trace.result.message ?? this.#trace.result.outcome);
    }
    this.#cursor = state.currentTimeUtc;
  }
  get endUtcMs(): number { return this.#trace.result.state.currentTimeUtc; }
  get currentTimeUtc(): number { return this.#cursor; }
  stateAt(utcMs: number): TimelineView {
    return publicView(this.#world, this.#origin, this.#trace, utcMs, this.#privateCurrent().discovered);
  }
  current(): TimelineView { return this.stateAt(this.#cursor); }
  stopAt(utcMs: number): SessionAdvance {
    validateUtcMs(utcMs);
    if (utcMs < this.#cursor) throw new RangeError('Execution cannot rewind; use stateAt for a read-only preview.');
    const state = stateFromTrace(this.#origin, this.#trace, utcMs);
    const journal = eventsAt(this.#trace, state.currentTimeUtc);
    const view = publicView(this.#world, this.#origin, this.#trace, utcMs, state.discovered);
    const newEvents = journal.slice(this.#consumedEvents);
    this.#cursor = state.currentTimeUtc; this.#consumedEvents = journal.length;
    return { ...view, newEvents };
  }
  resume(): SessionAdvance { return this.stopAt(this.endUtcMs); }
  /** Private save data, not a UI projection; consumedEvents is the event-delivery cursor. */
  savePayload(): SavePayload {
    return { schemaVersion: 3, simulationVersion: SIMULATION_CONFIG.simulationVersion, configVersion: SIMULATION_CONFIG.version,
      scenarioId: this.#world.scenarioId, scenarioVersion: this.#world.scenarioVersion, seed: this.#world.seed,
      world: copy(this.#world), origin: copy(this.#origin), actions: copy(this.#actions), options: copy(this.#options),
      cursorUtcMs: this.#cursor, consumedEvents: this.#consumedEvents, snapshot: this.#privateCurrent(), journal: eventsAt(this.#trace, this.#cursor) };
  }
  /** Used only after save validation; no resources or events are replayed into the snapshot. */
  restoreCursor(cursorUtcMs: number, consumedEvents: number): void {
    validateUtcMs(cursorUtcMs);
    if (this.#cursor !== this.#origin.currentTimeUtc || this.#consumedEvents !== 0) throw new RangeError('Restore requires a fresh session.');
    const count = eventsAt(this.#trace, cursorUtcMs).length;
    if (cursorUtcMs < this.#origin.currentTimeUtc || cursorUtcMs > this.endUtcMs || !Number.isInteger(consumedEvents) ||
        !(consumedEvents === count || (cursorUtcMs === this.#origin.currentTimeUtc && consumedEvents === 0))) throw new RangeError('Invalid saved execution or delivery cursor.');
    this.#cursor = cursorUtcMs; this.#consumedEvents = consumedEvents;
  }
  #privateCurrent(): State { return stateFromTrace(this.#origin, this.#trace, this.#cursor); }
}
