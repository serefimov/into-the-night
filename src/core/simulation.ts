import { greatCircle } from './geometry.js';
import { checkRoutePhaseSafety, createFlightPhases, routePhasePosition, ROUTE_MODEL } from './route.js';
import type { RoutePhase } from './route.js';
import type { SearchOptions } from './interval-search.js';
import { validateCoordinates } from './solar.js';
import type { Coordinates } from './solar.js';
import { validateUtcMs } from './time.js';

export const SIMULATION_CONFIG = Object.freeze({ version: 1, simulationVersion: 'resources-1', crew: 30,
  fuelCapacityKg: 18000, foodCapacityPersonHours: 2160, fuelKgPerKm: 3,
  fuelLoadingKgPerSecond: 200 / 60, foodLoadingPersonHoursPerSecond: 72 / 60,
  foodConsumptionPersonHoursPerSecond: 30 / 3600, achievementsDays: Object.freeze([30, 90, 180, 365]) });
export interface Stock { fuelKg: number; foodPersonHours: number }
export interface Airport extends Coordinates { id: string; stockBounds: { fuelKg: readonly [number, number]; foodPersonHours: readonly [number, number] } }
export interface World { scenarioId: string; scenarioVersion: number; seed: string; airports: readonly Airport[] }
export type Action = { kind: 'load'; fuelKg: number; foodPersonHours: number } | { kind: 'wait'; seconds: number } |
  { kind: 'prepare' } | { kind: 'service' } | { kind: 'fly'; destinationId: string };
export interface State {
  schemaVersion: 1; simulationVersion: string; configVersion: number; scenarioId: string; scenarioVersion: number; seed: string;
  startTimeUtc: number; currentTimeUtc: number; phase: 'planning' | 'simulating' | 'game_over';
  aircraft: Stock & { airportId: string | null; position: Coordinates; activeFlight: { from: string; to: string; stage: string; startUtcMs: number; endUtcMs: number } | null };
  stocks: Record<string, Stock>; discovered: string[]; serviceRequired: boolean; departurePrepared: boolean;
  distanceKm: number; completedFlights: number; achievements: number[];
  activeAction: { action: Action; startedUtcMs: number; transferred: Stock } | null;
  death: { reason: 'sun' | 'food' | 'fuel'; utcMs: number } | null;
}
export interface Event { kind: string; utcMs: number; detail: Record<string, unknown> }
export type PublicState = Omit<State, 'stocks'> & { warehouses: Record<string, Stock | Airport['stockBounds']> };
export type Outcome = 'completed' | 'needs_discovery' | 'needs_refinement' | 'validation_error' | 'death' | 'risk_confirmation_required';
export interface Execution { outcome: Outcome; state: State; events: Event[]; message: string | null }
export interface Forecast { outcome: Outcome; state: PublicState; events: Event[]; message: string | null }
const C = SIMULATION_CONFIG.foodConsumptionPersonHoursPerSecond;
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}
function amount(value: number): void { if (!Number.isFinite(value) || value < 0) throw new RangeError('Amounts must be finite and nonnegative.'); }
function airport(world: World, id: string): Airport {
  const result = world.airports.find(a => a.id === id);
  if (!result) throw new RangeError(`Unknown airport: ${id}`);
  return result;
}
export function createSimulation(world: World, stocks: Record<string, Stock>, startUtcMs: number, airportId: string,
  aircraft: Stock, serviced = true): State {
  validateUtcMs(startUtcMs);
  if (!world.scenarioId || !Number.isInteger(world.scenarioVersion) || world.scenarioVersion < 1 || typeof world.seed !== 'string') throw new RangeError('Invalid scenario metadata.');
  const ids = new Set<string>();
  for (const a of world.airports) {
    validateCoordinates(a);
    if (!a.id || ids.has(a.id)) throw new RangeError('Airport IDs must be unique.');
    ids.add(a.id);
    if (!Object.hasOwn(stocks, a.id)) throw new RangeError('Missing stock.');
    for (const k of ['fuelKg', 'foodPersonHours'] as const) {
      const bounds = a.stockBounds[k]; amount(bounds[0]); amount(bounds[1]); amount(stocks[a.id]![k]);
      if (bounds[0] > bounds[1] || stocks[a.id]![k] < bounds[0] || stocks[a.id]![k] > bounds[1]) throw new RangeError('Stock outside scenario bounds.');
    }
  }
  amount(aircraft.fuelKg); amount(aircraft.foodPersonHours);
  if (aircraft.fuelKg > SIMULATION_CONFIG.fuelCapacityKg || aircraft.foodPersonHours > SIMULATION_CONFIG.foodCapacityPersonHours || typeof serviced !== 'boolean') throw new RangeError('Invalid aircraft resources.');
  const a = airport(world, airportId);
  return { schemaVersion: 1, simulationVersion: SIMULATION_CONFIG.simulationVersion, configVersion: 1,
    scenarioId: world.scenarioId, scenarioVersion: world.scenarioVersion, seed: world.seed, startTimeUtc: startUtcMs,
    currentTimeUtc: startUtcMs, phase: 'planning', aircraft: { ...aircraft, airportId,
      position: { latitudeDeg: a.latitudeDeg, longitudeDeg: a.longitudeDeg }, activeFlight: null }, stocks: clone(stocks),
    discovered: [airportId], serviceRequired: !serviced, departurePrepared: false, distanceKm: 0,
    completedFlights: 0, achievements: [], activeAction: null, death: null };
}
export function visibleState(world: World, state: State): PublicState {
  const { stocks, ...publicFields } = clone(state);
  const warehouses = Object.fromEntries(world.airports.map(a => [a.id,
    state.discovered.includes(a.id) ? clone(stocks[a.id]!) : clone(a.stockBounds)]));
  return { ...publicFields, warehouses };
}
/** Equality at the end of cruise is allowed; a deficit has an analytic event time. */
export function fuelExhaustionSeconds(fuelKg: number, distanceKm: number, durationSeconds: number): number | null {
  amount(fuelKg); amount(distanceKm); amount(durationSeconds);
  const required = distanceKm * SIMULATION_CONFIG.fuelKgPerKm;
  return fuelKg >= required ? null : durationSeconds * fuelKg / required;
}
function run(world: World, original: State, actions: readonly Action[], forecast: boolean, options: SearchOptions): Execution {
  const state = clone(original), events: Event[] = [];
  let outcome: Outcome = 'completed', message: string | null = null;
  const emit = (kind: string, detail: Record<string, unknown> = {}) => events.push({ kind, utcMs: state.currentTimeUtc, detail });
  try {
    if (state.schemaVersion !== 1 || state.phase !== 'planning' || state.aircraft.airportId === null || state.aircraft.activeFlight !== null || state.death !== null || state.simulationVersion !== SIMULATION_CONFIG.simulationVersion || state.configVersion !== 1 ||
        state.scenarioId !== world.scenarioId || state.scenarioVersion !== world.scenarioVersion || state.seed !== world.seed) throw new RangeError('Incompatible or non-planning state.');
    validateUtcMs(state.startTimeUtc); validateUtcMs(state.currentTimeUtc);
    if (state.startTimeUtc > state.currentTimeUtc || !state.discovered.includes(state.aircraft.airportId!)) throw new RangeError('Invalid planning state.');
    amount(state.aircraft.fuelKg); amount(state.aircraft.foodPersonHours);
    if (state.aircraft.fuelKg > SIMULATION_CONFIG.fuelCapacityKg || state.aircraft.foodPersonHours > SIMULATION_CONFIG.foodCapacityPersonHours) throw new RangeError('Aircraft exceeds capacity.');
    if (!Array.isArray(actions)) throw new RangeError('Plan must be an array.');
    for (const action of actions) {
      if (!action || !['load', 'wait', 'prepare', 'service', 'fly'].includes(action.kind)) throw new RangeError('Invalid action.');
      if (action.kind === 'load') { amount(action.fuelKg); amount(action.foodPersonHours); }
      if (action.kind === 'wait') amount(action.seconds);
      if (action.kind === 'fly') airport(world, action.destinationId);
    }
    state.phase = 'simulating';
    for (let index = 0; index < actions.length && outcome === 'completed'; index++) {
      const action = actions[index]!;
      const id = state.aircraft.airportId!;
      const a = airport(world, id), stock = state.stocks[id]!;
      if (forecast && !state.discovered.includes(id)) { outcome = 'needs_discovery'; break; }
      state.activeAction = { action: clone(action), startedUtcMs: state.currentTimeUtc, transferred: { fuelKg: 0, foodPersonHours: 0 } };
      if (action.kind === 'fly') {
        if (state.serviceRequired || !state.departurePrepared) throw new RangeError('Flight requires service and departure preparation.');
        const target = airport(world, action.destinationId), path = greatCircle(a, target);
        if (state.aircraft.fuelKg < path.distanceKm * SIMULATION_CONFIG.fuelKgPerKm) throw new RangeError('Insufficient fuel; flight blocked.');
        const phases = createFlightPhases(state.currentTimeUtc, a, target);
        state.departurePrepared = false; state.aircraft.airportId = null; emit('takeoff', { from: id, to: target.id });
        for (const phase of phases) {
          state.aircraft.activeFlight = { from: id, to: target.id, stage: phase.kind, startUtcMs: phase.startUtcMs, endUtcMs: phase.endUtcMs };
          const distance = phase.path?.distanceKm ?? 0;
          advance(phase, false, stock, 0, 0, (phase.endUtcMs - phase.startUtcMs) / 1000, distance);
          if (outcome !== 'completed') break;
        }
        if (outcome === 'completed') {
          state.aircraft.airportId = target.id; state.aircraft.activeFlight = null; state.serviceRequired = true; state.completedFlights++;
          emit('landing', { airportId: target.id });
          if (!state.discovered.includes(target.id)) {
            if (!forecast) { state.discovered.push(target.id); emit('airport_discovered', { airportId: target.id }); }
            // The rest of a plan requires fresh planning against the newly revealed warehouse.
            if (index + 1 < actions.length) outcome = 'needs_discovery';
          }
        }
      } else if (action.kind === 'load') {
        if (action.fuelKg > stock.fuelKg || action.foodPersonHours > stock.foodPersonHours ||
            action.fuelKg > SIMULATION_CONFIG.fuelCapacityKg - state.aircraft.fuelKg || action.foodPersonHours > SIMULATION_CONFIG.foodCapacityPersonHours - state.aircraft.foodPersonHours) throw new RangeError('Loading exceeds initial stock or free capacity.');
        emit('loading_started', { fuelKg: action.fuelKg, foodPersonHours: action.foodPersonHours });
        if (action.fuelKg === 0 && action.foodPersonHours === 0) ground(0, stock, 0, 0);
        let fuel = action.fuelKg, food = action.foodPersonHours;
        while ((fuel > 0 || food > 0) && outcome === 'completed') {
          if (stock.foodPersonHours === 0 && food > 0) { emit('loading_limited', { untransferredFoodPersonHours: food }); food = 0; }
          const rf = fuel > 0 ? SIMULATION_CONFIG.fuelLoadingKgPerSecond : 0;
          const re = food > 0 ? SIMULATION_CONFIG.foodLoadingPersonHoursPerSecond : 0;
          let duration = Math.min(rf ? fuel / rf : Infinity, re ? food / re : Infinity,
            stock.foodPersonHours > 0 ? stock.foodPersonHours / (C + re) : Infinity);
          if (!Number.isFinite(duration)) break;
          const fuelDone = rf > 0 && duration === fuel / rf, foodDone = re > 0 && duration === food / re;
          const storeDone = stock.foodPersonHours > 0 && duration === stock.foodPersonHours / (C + re);
          const before = clone(state.activeAction!.transferred);
          ground(duration, stock, rf, re);
          fuel = fuelDone && outcome === 'completed' ? 0 : Math.max(0, fuel - (state.activeAction!.transferred.fuelKg - before.fuelKg));
          food = foodDone && outcome === 'completed' ? 0 : Math.max(0, food - (state.activeAction!.transferred.foodPersonHours - before.foodPersonHours));
          if (storeDone && outcome === 'completed') stock.foodPersonHours = 0;
        }
        if (outcome === 'completed') emit('loading_completed', { ...state.activeAction!.transferred });
      } else {
        if (action.kind === 'prepare' && (state.serviceRequired || state.departurePrepared)) throw new RangeError('Preparation requires service and cannot be repeated.');
        if (action.kind === 'service' && !state.serviceRequired) throw new RangeError('Service is required only once after landing.');
        const kind = action.kind === 'prepare' ? 'departure_preparation' : action.kind;
        emit(`${kind}_started`);
        let left = action.kind === 'wait' ? action.seconds : ROUTE_MODEL.groundPhaseSeconds;
        // A zero-duration action still checks immediate death.
        do {
          const duration = Math.min(left, stock.foodPersonHours > 0 ? stock.foodPersonHours / C : left);
          const exhausted = stock.foodPersonHours > 0 && duration === stock.foodPersonHours / C;
          ground(duration, stock, 0, 0);
          if (exhausted && outcome === 'completed') stock.foodPersonHours = 0;
          left = Math.max(0, left - duration);
          if (outcome !== 'completed') break;
        } while (left > 0);
        if (outcome === 'completed') {
          if (action.kind === 'prepare') state.departurePrepared = true;
          if (action.kind === 'service') state.serviceRequired = false;
          emit(`${kind}_completed`);
        }
      }
      if (outcome === 'completed' || outcome === 'needs_discovery') state.activeAction = null;
    }
    if (!state.death) state.phase = 'planning';
    return { outcome, state, events, message };
  } catch (error) { return { outcome: 'validation_error', state: clone(original), events: [], message: error instanceof Error ? error.message : String(error) }; }

  function ground(seconds: number, stock: Stock, rf: number, re: number): void {
    const start = state.currentTimeUtc, end = start + seconds * 1000;
    const phase: RoutePhase = { kind: 'service', legIndex: state.completedFlights, startUtcMs: start, endUtcMs: end, location: state.aircraft.position, path: null };
    advance(phase, true, stock, rf, re, seconds, 0);
  }
  function advance(phase: RoutePhase, onGround: boolean, stock: Stock, rf: number, re: number, seconds: number, distance: number): void {
    validateUtcMs(phase.endUtcMs);
    const totalFood = state.aircraft.foodPersonHours + (onGround ? stock.foodPersonHours : 0);
    const hunger = totalFood / C;
    const fuelTime = distance > 0 ? fuelExhaustionSeconds(state.aircraft.fuelKg, distance, seconds) : null;
    const resourceTime = Math.min(hunger, fuelTime ?? Infinity);
    const fatalResource = resourceTime <= seconds;
    const cutoff = phase.startUtcMs + Math.min(seconds, resourceTime) * 1000;
    const safety = checkRoutePhaseSafety(phase, options, cutoff);
    const end = safety.status === 'unsafe' ? safety.witnessUtcMs! : safety.status === 'indeterminate' ? safety.safeUntilUtcMs : cutoff;
    // Preserve analytic durations at certified boundaries; epoch subtraction loses sub-millisecond precision.
    const dt = safety.status === 'safe' ? Math.min(seconds, resourceTime) : (end - phase.startUtcMs) / 1000;
    if (seconds > 0 && phase.endUtcMs === phase.startUtcMs) throw new RangeError('Duration below UTC numeric resolution.');
    const transferredFuel = Math.min(rf * dt, stock.fuelKg, SIMULATION_CONFIG.fuelCapacityKg - state.aircraft.fuelKg,
      state.activeAction?.action.kind === 'load' ? state.activeAction.action.fuelKg - state.activeAction.transferred.fuelKg : Infinity);
    const transferredFood = Math.min(re * dt, SIMULATION_CONFIG.foodCapacityPersonHours - state.aircraft.foodPersonHours,
      state.activeAction?.action.kind === 'load' ? state.activeAction.action.foodPersonHours - state.activeAction.transferred.foodPersonHours : Infinity);
    stock.fuelKg = Math.max(0, stock.fuelKg - transferredFuel);
    state.aircraft.fuelKg += transferredFuel;
    const burn = distance * SIMULATION_CONFIG.fuelKgPerKm * (seconds > 0 ? dt / seconds : 0);
    state.aircraft.fuelKg = Math.max(0, state.aircraft.fuelKg - burn);
    if (state.activeAction) { state.activeAction.transferred.fuelKg += transferredFuel; state.activeAction.transferred.foodPersonHours += transferredFood; }
    if (onGround && stock.foodPersonHours > 0) {
      stock.foodPersonHours = Math.max(0, stock.foodPersonHours - transferredFood - C * dt);
      state.aircraft.foodPersonHours += transferredFood;
    } else state.aircraft.foodPersonHours = Math.max(0, state.aircraft.foodPersonHours - C * dt);
    state.currentTimeUtc = end;
    if (phase.endUtcMs > phase.startUtcMs) state.aircraft.position = routePhasePosition(phase, end);
    state.distanceKm += distance * (seconds > 0 ? dt / seconds : 0);
    const death = safety.status === 'unsafe' ? 'sun' : safety.status === 'safe' && fatalResource ? (hunger <= (fuelTime ?? Infinity) ? 'food' : 'fuel') : null;
    for (const days of SIMULATION_CONFIG.achievementsDays) {
      const utc = state.startTimeUtc + days * 86400000;
      if (!state.achievements.includes(days) && utc <= end && !(death && utc === end)) {
        state.achievements.push(days); events.push({ kind: 'achievement', utcMs: utc, detail: { days } });
      }
    }
    if (death) { state.death = { reason: death, utcMs: end }; state.phase = 'game_over'; outcome = 'death'; emit('death', { reason: death, solarBracketUtcMs: safety.bracket }); }
    else if (safety.status === 'indeterminate') { outcome = 'needs_refinement'; message = safety.reason; }
  }
}
export function forecastPlan(world: World, state: State, actions: readonly Action[], options: SearchOptions = {}): Forecast {
  const result = run(world, state, actions, true, options);
  return { ...result, state: visibleState(world, result.state) };
}
export function executePlan(world: World, state: State, actions: readonly Action[], options: SearchOptions & { confirmRisk?: boolean } = {}): Execution {
  const preview = run(world, state, actions, true, options);
  if (preview.outcome === 'validation_error') return preview;
  if (preview.outcome === 'needs_refinement') return { ...preview, state: clone(state), events: [] };
  if (preview.outcome === 'death' && options.confirmRisk !== true) return { outcome: 'risk_confirmation_required', state: clone(state), events: [], message: `${preview.state.death!.reason} at UTC ${preview.state.death!.utcMs}` };
  return run(world, state, actions, false, options);
}
