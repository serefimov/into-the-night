// SPDX-License-Identifier: GPL-3.0-only
import { validateResearchState } from './mission-research.js';
import { forecastMissionFlight } from './mission-flight.js';
import { aircraftMetrics } from './aircraft.js';
import { routePhasePosition } from './route.js';
import { solarExposure, validateCoordinates } from './solar.js';
import { searchLimits } from './interval-search.js';
import { validateUtcMs } from './time.js';
import { canonicalJson, saveChecksum } from './serialization.js';
export const MISSION_MODEL = Object.freeze({ mode: 'airport-flight-v2', simulationVersion: 'flight-cycle-2', schemaVersion: 2, eventVersion: 2, saveVersion: 2 });
function copy(value) {
    if (Array.isArray(value))
        return value.map(copy);
    if (value !== null && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
    return value;
}
function initialResearch(d) { return { ...copy(d.initial), flights: 0, distanceKm: 0, won: false }; }
function validateDefinition(d) {
    canonicalJson(d);
    for (const key of ['scenarioId', 'seed', 'stockVersion', 'worldVersion'])
        if (typeof d[key] !== 'string' || !d[key])
            throw new RangeError('Missing mission ' + key);
    if (!Number.isInteger(d.scenarioVersion) || d.scenarioVersion < 1 || !['arrival', 'after_service'].includes(d.targetCompletion))
        throw new RangeError('Invalid mission version or completion');
    if (!Array.isArray(d.airports) || d.airports.length < 2)
        throw new RangeError('Mission needs airports');
    const ids = new Set();
    for (const a of d.airports) {
        validateCoordinates(a);
        if (typeof a.id !== 'string' || !a.id || ids.has(a.id) || !['screened-candidate', 'unverified'].includes(a.suitability.status))
            throw new RangeError('Invalid mission airport');
        ids.add(a.id);
    }
    if (Object.keys(d.initial.stocks).length !== ids.size || Object.keys(d.initial.stocks).some(id => !ids.has(id)) || d.initial.airportId === d.targetId || d.airports.find(a => a.id === d.initial.airportId)?.suitability.status !== 'screened-candidate')
        throw new RangeError('Invalid mission stock coverage or endpoints');
    validateResearchState({ profile: d.profile, airports: d.airports, targetId: d.targetId }, initialResearch(d));
}
function validateOptions(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['eventToleranceSeconds', 'maxIntervalSeconds', 'maxEvaluations'].includes(k)))
        throw new RangeError('Invalid mission search options');
    searchLimits(options);
}
/** A no-food, no-wait session. The shared departure-fuel transition supplies every accepted physical plan. */
export class MissionSession {
    #definition;
    #options;
    #initial;
    #plans = [];
    #cursor;
    #consumedEvents = 0;
    #initialSun;
    constructor(definition, options = {}) {
        this.#definition = copy(definition);
        this.#options = copy(options);
        validateDefinition(this.#definition);
        validateOptions(this.#options);
        this.#initial = initialResearch(this.#definition);
        this.#cursor = this.#initial.utcMs;
        this.#initialSun = !solarExposure(this.#airport(this.#initial.airportId), this.#cursor).safe;
    }
    get definition() { return copy(this.#definition); }
    get currentTimeUtc() { return this.#cursor; }
    get endUtcMs() { return this.#plans.at(-1)?.forecast.endUtcMs ?? this.#initial.utcMs; }
    #airport(id) { return this.#definition.airports.find(a => a.id === id); }
    #ready() { return this.#plans.at(-1)?.forecast.next ?? this.#initial; }
    forecast(destinationId) {
        const view = this.current().state;
        const blocked = (reason) => ({ allowed: false, reasons: [reason], forecast: null });
        if (view.status !== 'running')
            return blocked('mission_' + view.status);
        if (view.phase !== 'planning')
            return blocked('mission_busy');
        if (!this.#definition.airports.some(a => a.id === destinationId))
            return blocked('unknown_airport');
        if (destinationId === view.airportId)
            return blocked('same_airport');
        try {
            const forecast = forecastMissionFlight(this.#definition, this.#ready(), destinationId, this.#options);
            return { allowed: forecast.allowed, reasons: forecast.reasons, forecast };
        }
        catch (error) {
            if (error instanceof RangeError && /Coincident|antipodal/.test(error.message))
                return blocked('ambiguous_route');
            throw error;
        }
    }
    fly(destinationId) {
        const choice = this.forecast(destinationId);
        if (choice.allowed)
            this.#plans.push({ origin: copy(this.#ready()), toId: destinationId, forecast: copy(choice.forecast) });
        return choice;
    }
    /** Explicit analysis for UI/CLI. A planning dead end never advances UTC or causes an invented death. */
    availability() {
        const state = this.current().state, availableIds = [], unresolvedIds = [];
        if (state.status !== 'running')
            return { status: 'terminal', availableIds, unresolvedIds };
        if (state.phase !== 'planning')
            return { status: 'busy', availableIds, unresolvedIds };
        for (const a of this.#definition.airports) {
            if (a.id === state.airportId)
                continue;
            const f = this.forecast(a.id);
            if (f.allowed)
                availableIds.push(a.id);
            else if (f.reasons.length && f.reasons.every(r => r === 'solar_indeterminate'))
                unresolvedIds.push(a.id);
        }
        return { status: availableIds.length ? 'available' : unresolvedIds.length ? 'unresolved' : 'no_safe_choices', availableIds, unresolvedIds };
    }
    #events() {
        const events = [];
        const append = (kind, utcMs, flightIndex, airportId) => events.push({ version: 2, sequence: events.length, kind, utcMs, flightIndex, airportId });
        append('mission_started', this.#initial.utcMs, 0, this.#initial.airportId);
        if (this.#initialSun)
            append('mission_died', this.#initial.utcMs, 0, this.#initial.airportId);
        for (const plan of this.#plans) {
            const f = plan.forecast, index = plan.origin.flights + 1;
            append('flight_committed', plan.origin.utcMs, index, plan.origin.airportId);
            const refuel = f.phases.find(p => p.label === 'refuelling');
            if (refuel)
                append('refuelling_started', refuel.route.startUtcMs, index, plan.origin.airportId);
            append('flight_started', f.departureUtcMs, index, plan.origin.airportId);
            append('arrived', f.arrivalUtcMs, index, plan.toId);
            append('flight_completed', f.endUtcMs, index, plan.toId);
            if (f.next.won)
                append('mission_won', f.endUtcMs, index, plan.toId);
        }
        return events;
    }
    #base(r) {
        const d = this.#definition, status = this.#initialSun ? 'dead' : r.won ? 'won' : 'running';
        return { mode: MISSION_MODEL.mode, schemaVersion: 2, simulationVersion: MISSION_MODEL.simulationVersion, scenarioId: d.scenarioId, scenarioVersion: d.scenarioVersion, seed: d.seed, stockVersion: d.stockVersion, worldVersion: d.worldVersion,
            startUtcMs: this.#initial.utcMs, utcMs: r.utcMs, airportId: r.airportId, position: { latitudeDeg: this.#airport(r.airportId).latitudeDeg, longitudeDeg: this.#airport(r.airportId).longitudeDeg },
            fuelKg: r.fuelKg, stocks: copy(r.stocks), flights: r.flights, distanceKm: r.distanceKm, status, phase: status === 'running' ? 'planning' : status,
            death: this.#initialSun ? { kind: 'sun', utcMs: this.#initial.utcMs } : null, activeFlight: null };
    }
    #during(plan, time) {
        const f = plan.forecast, a = this.#definition.profile.assumptions, m = aircraftMetrics(this.#definition.profile), state = this.#base(plan.origin);
        state.utcMs = time;
        let fuel = plan.origin.fuelKg;
        for (const phase of f.phases) {
            const p = phase.route;
            if (time < p.startUtcMs)
                break;
            const elapsed = Math.max(0, Math.min(time, p.endUtcMs) - p.startUtcMs) / 1000, duration = (p.endUtcMs - p.startUtcMs) / 1000, fraction = duration === 0 ? 1 : elapsed / duration;
            switch (phase.label) {
                case 'departure':
                    fuel -= a.departureBurnKg * fraction;
                    break;
                case 'cruise':
                    fuel -= f.distanceKm * a.cruiseBurnKgPerKm * fraction;
                    state.distanceKm = plan.origin.distanceKm + f.distanceKm * fraction;
                    break;
                case 'arrival':
                    fuel -= a.arrivalBurnKg * fraction;
                    if (time >= p.endUtcMs)
                        fuel = f.flight.arrivalFuelKg;
                    break;
                case 'service':
                    fuel -= a.serviceBurnKgPerSecond * elapsed;
                    break;
                case 'refuelling': {
                    const transfer = Math.min(f.refuelling.transferKg, Math.max(0, elapsed - a.refuellingSetupSeconds) * m.refuellingKgPerSecond);
                    fuel = Math.min(f.refuelling.fuelKg, plan.origin.fuelKg + transfer);
                    state.stocks[plan.origin.airportId] = plan.origin.stocks[plan.origin.airportId] - transfer;
                    if (time >= p.endUtcMs) {
                        fuel = f.refuelling.fuelKg;
                        state.stocks[plan.origin.airportId] = f.refuelling.stockKg;
                    }
                    break;
                }
            }
            if (time < p.endUtcMs) {
                state.phase = phase.label;
                state.position = routePhasePosition(p, time);
                state.airportId = (phase.label === 'departure' || phase.label === 'refuelling') ? plan.origin.airportId : time >= f.arrivalUtcMs ? plan.toId : null;
                state.activeFlight = { fromId: plan.origin.airportId, toId: plan.toId, startUtcMs: plan.origin.utcMs, departureUtcMs: f.departureUtcMs, arrivalUtcMs: f.arrivalUtcMs, endUtcMs: f.endUtcMs, phaseStartUtcMs: p.startUtcMs, phaseEndUtcMs: p.endUtcMs };
                break;
            }
        }
        state.fuelKg = fuel;
        state.flights = plan.origin.flights + (time >= f.arrivalUtcMs ? 1 : 0);
        return state;
    }
    /** Preview may inspect accepted history/future, but never commits time, fuel or event delivery. */
    stateAt(utcMs) {
        validateUtcMs(utcMs);
        if (utcMs < this.#initial.utcMs)
            throw new RangeError('UTC precedes mission');
        const time = Math.min(utcMs, this.endUtcMs);
        let state = this.#base(this.#initial);
        for (const plan of this.#plans) {
            if (time < plan.origin.utcMs)
                break;
            state = time >= plan.forecast.endUtcMs ? this.#base(plan.forecast.next) : this.#during(plan, time);
        }
        return { state, events: this.#events().filter(e => e.utcMs <= time) };
    }
    current() { return this.stateAt(this.#cursor); }
    stopAt(utcMs) {
        validateUtcMs(utcMs);
        if (utcMs < this.#cursor)
            throw new RangeError('Execution cannot rewind');
        this.#cursor = Math.min(utcMs, this.endUtcMs);
        const view = this.current(), newEvents = view.events.slice(this.#consumedEvents);
        this.#consumedEvents = view.events.length;
        return { ...view, newEvents };
    }
    resume() { return this.stopAt(this.endUtcMs); }
    save() {
        const payload = { mode: MISSION_MODEL.mode, simulationVersion: MISSION_MODEL.simulationVersion, eventVersion: 2, definition: copy(this.#definition), options: copy(this.#options),
            choices: this.#plans.map(p => p.toId), cursorUtcMs: this.#cursor, consumedEvents: this.#consumedEvents, snapshot: this.current() };
        return canonicalJson({ format: 'into-the-night-mission', version: 2, checksum: saveChecksum(payload), payload });
    }
    /** Separate format: historical survival saves are rejected rather than reinterpreted as food-free missions. */
    static restore(serialized, expectedDefinition) {
        if (typeof serialized !== 'string' || serialized.length > 16 * 1024 * 1024)
            throw new RangeError('Invalid mission save size');
        const envelope = JSON.parse(serialized);
        if (!envelope || envelope.format !== 'into-the-night-mission' || envelope.version !== 2 || !envelope.payload || envelope.checksum !== saveChecksum(envelope.payload))
            throw new RangeError('Unsupported or damaged mission save');
        const p = envelope.payload;
        if (p.mode !== MISSION_MODEL.mode || p.simulationVersion !== MISSION_MODEL.simulationVersion || p.eventVersion !== 2)
            throw new RangeError('Incompatible mission save version');
        if (expectedDefinition && canonicalJson(p.definition) !== canonicalJson(expectedDefinition))
            throw new RangeError('Mission definition differs');
        if (!Array.isArray(p.choices) || p.choices.length > 1000 || p.choices.some(id => typeof id !== 'string'))
            throw new RangeError('Invalid mission choices');
        const session = new MissionSession(p.definition, p.options);
        for (const [i, id] of p.choices.entries()) {
            if (i)
                session.resume();
            if (!session.fly(id).allowed)
                throw new RangeError('Saved flight is blocked');
        }
        validateUtcMs(p.cursorUtcMs);
        const lastStart = session.#plans.at(-1)?.origin.utcMs ?? session.#initial.utcMs;
        if (p.cursorUtcMs < lastStart || p.cursorUtcMs > session.endUtcMs)
            throw new RangeError('Invalid mission cursor');
        session.#cursor = p.cursorUtcMs;
        const actual = session.current();
        if (!Number.isInteger(p.consumedEvents) || p.consumedEvents < 0 || p.consumedEvents > actual.events.length || canonicalJson(p.snapshot) !== canonicalJson(actual))
            throw new RangeError('Mission save snapshot or journal differs');
        session.#consumedEvents = p.consumedEvents;
        return session;
    }
}
