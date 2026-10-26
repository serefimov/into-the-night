// SPDX-License-Identifier: GPL-3.0-only
import { aircraftLeg, aircraftMetrics, aircraftRefuelling, validateAircraftProfile } from './aircraft.js';
import { greatCircle } from './geometry.js';
import { checkRoutePhaseSafety } from './route.js';
import { searchLimits } from './interval-search.js';
import { validateUtcMs } from './time.js';
export const RESEARCH_MODEL = Object.freeze({ version: 'jfk-research-1', targetCompletion: 'safe-end-of-arrival-before-service', initialGroundState: 'ready-for-departure-phase' });
function airport(world, id) { const a = world.airports.find(a => a.id === id); if (!a)
    throw new RangeError('Unknown airport: ' + id); return a; }
function nonnegative(n, name) { if (!Number.isFinite(n) || n < 0)
    throw new RangeError('Invalid ' + name); }
export function validateResearchState(world, state) {
    validateAircraftProfile(world.profile);
    validateUtcMs(state.utcMs);
    airport(world, state.airportId);
    airport(world, world.targetId);
    if (world.targetCompletion !== undefined && !['arrival', 'after_turnaround'].includes(world.targetCompletion))
        throw new RangeError('Invalid target completion');
    nonnegative(state.fuelKg, 'fuel');
    if (state.fuelKg > aircraftMetrics(world.profile).fuelCapacityKg)
        throw new RangeError('Overfull tank');
    nonnegative(state.flights, 'flights');
    nonnegative(state.distanceKm, 'distance');
    if (!Number.isInteger(state.flights) || typeof state.won !== 'boolean' || (state.won && state.airportId !== world.targetId))
        throw new RangeError('Invalid mission progress');
    for (const a of world.airports)
        nonnegative(state.stocks[a.id], 'stock ' + a.id);
}
export function auditResearchPhases(phases, options = {}) {
    if (!phases.length)
        throw new RangeError('No phases to audit');
    const limit = searchLimits(options);
    let evaluations = 0, safeUntilUtcMs = phases[0].route.startUtcMs;
    for (const phase of phases) {
        if (phase.route.startUtcMs !== safeUntilUtcMs)
            throw new RangeError('Noncontiguous phases');
        const remaining = limit.maxEvaluations - evaluations;
        if (remaining < 4)
            return { status: 'indeterminate', evaluations, phase: phase.label, eventUtcMs: null, bracketUtcMs: [phase.route.startUtcMs, phase.route.endUtcMs], safeUntilUtcMs, reason: 'evaluation_budget' };
        const result = checkRoutePhaseSafety(phase.route, { ...options, maxEvaluations: remaining });
        evaluations += result.evaluations;
        safeUntilUtcMs = result.safeUntilUtcMs;
        if (result.status !== 'safe')
            return { status: result.status, evaluations, phase: phase.label, eventUtcMs: result.witnessUtcMs, bracketUtcMs: result.bracket, safeUntilUtcMs, reason: result.reason };
    }
    return { status: 'safe', evaluations, phase: null, eventUtcMs: null, bracketUtcMs: null, safeUntilUtcMs, reason: null };
}
/** A research move exactly matches the prospective button: no waits or partial refuelling choices. */
export function forecastResearchFlight(world, state, destinationId, options = {}) {
    validateResearchState(world, state);
    if (state.won)
        throw new RangeError('Mission already complete');
    const from = airport(world, state.airportId), to = airport(world, destinationId), path = greatCircle(from, to), p = world.profile, a = p.assumptions, m = aircraftMetrics(p);
    const flight = aircraftLeg(p, path.distanceKm, state.fuelKg), reasons = [...flight.reasons];
    if (to.suitability.status !== 'screened-candidate')
        reasons.push('unverified_airport');
    const phases = [];
    let cursor = state.utcMs;
    function append(label, kind, location, seconds, moving = false) {
        const start = cursor;
        cursor += seconds * 1000;
        validateUtcMs(cursor);
        phases.push({ label, route: { kind, legIndex: state.flights, startUtcMs: start, endUtcMs: cursor, location: { latitudeDeg: location.latitudeDeg, longitudeDeg: location.longitudeDeg }, path: moving ? path : null } });
    }
    append('departure', 'takeoff', from, a.departureSeconds);
    append('cruise', 'cruise', from, path.distanceKm / m.cruiseKmPerHour * 3600, true);
    append('arrival', 'landing', to, a.arrivalSeconds);
    const arrivalUtcMs = cursor;
    let refuelling = null;
    const terminalArrival = destinationId === world.targetId && world.targetCompletion !== 'after_turnaround';
    if (!terminalArrival && flight.arrivalFuelKg >= 0) {
        append('service', 'service', to, a.serviceSeconds);
        const groundFuel = flight.arrivalFuelKg - a.serviceSeconds * a.serviceBurnKgPerSecond;
        if (groundFuel < 0)
            reasons.push('ground_fuel');
        else {
            refuelling = aircraftRefuelling(p, groundFuel, state.stocks[destinationId]);
            if (refuelling.durationSeconds > 0)
                append('refuelling', 'service', to, refuelling.durationSeconds);
        }
    }
    const solar = auditResearchPhases(phases, options);
    if (solar.status !== 'safe')
        reasons.push(solar.status === 'unsafe' ? 'sun' : 'solar_indeterminate');
    const allowed = reasons.length === 0;
    const next = allowed ? { airportId: destinationId, utcMs: cursor, fuelKg: refuelling ? refuelling.fuelKg : flight.arrivalFuelKg,
        stocks: { ...state.stocks, ...(refuelling ? { [destinationId]: refuelling.stockKg } : {}) }, flights: state.flights + 1, distanceKm: state.distanceKm + path.distanceKm, won: destinationId === world.targetId } : null;
    return { allowed, reasons, distanceKm: path.distanceKm, arrivalUtcMs, endUtcMs: cursor, flight, refuelling, phases, solarScope: terminalArrival ? 'terminal_arrival' : refuelling ? 'automatic_turnaround' : 'flight_only_invalid_resources', solar, next };
}
/** Recompute and accept the same validated transition; rejected choices never mutate input. */
export function executeResearchFlight(world, state, destinationId, options = {}) {
    return forecastResearchFlight(world, state, destinationId, options);
}
/** All legal initial fuel lies in this closed interval. For a fixed destination,
 * solar flight timing is independent of fuel; maximum fuel minimizes compulsory
 * ground refuelling. Thus an unsafe upper-end trajectory rules out the interval
 * only when the audit locates actual Sun (not numerical uncertainty). */
export function firstFlightFuelEnvelope(world, fromId, toId) {
    const from = airport(world, fromId), to = airport(world, toId), p = world.profile, a = p.assumptions, distance = greatCircle(from, to).distanceKm;
    const burn = a.departureBurnKg + a.arrivalBurnKg + distance * a.cruiseBurnKgPerKm;
    const minimumKg = burn + a.planningReserveKg;
    const maximumKg = Math.min(aircraftMetrics(p).fuelCapacityKg, p.facts.maxTakeoffKg - a.zeroFuelKg, p.facts.maxLandingKg - a.zeroFuelKg + burn);
    return { minimumKg, maximumKg, feasible: minimumKg <= maximumKg };
}
