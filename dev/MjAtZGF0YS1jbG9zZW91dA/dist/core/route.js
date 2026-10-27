import { SOLAR_MODEL } from './config.js';
import { greatCircle, greatCircleNormal, greatCirclePosition } from './geometry.js';
import { solarDirection, surfaceNormal, validateCoordinates } from './solar.js';
import { validateUtcMs } from './time.js';
import { searchLimits, searchSolarInterval } from './interval-search.js';
export const ROUTE_MODEL = Object.freeze({ version: 'great-circle-solar-1', configVersion: 1, solarModelVersion: 'meeus-noaa-1',
    speedKmPerHour: 850, groundPhaseSeconds: 900,
    solarSpeedBoundPerSecond: 8e-5, solarCurvatureBoundPerSecond2: 8e-9,
    evaluationErrorBound: 1e-8 });
export function createRoutePlan(request) {
    validateUtcMs(request.startUtcMs);
    if (!Array.isArray(request.waypoints) || request.waypoints.length < 2 ||
        (request.initialServiceRequired !== undefined && typeof request.initialServiceRequired !== 'boolean')) {
        throw new RangeError('Route requires at least two waypoints and a boolean initialServiceRequired.');
    }
    request.waypoints.forEach(validateCoordinates);
    const phases = [];
    let cursor = request.startUtcMs, distanceKm = 0;
    function append(kind, legIndex, location, durationSeconds, path = null) {
        const startUtcMs = cursor;
        cursor += durationSeconds * 1000;
        validateUtcMs(cursor);
        phases.push(Object.freeze({ kind, legIndex, startUtcMs, endUtcMs: cursor,
            location: Object.freeze({ latitudeDeg: location.latitudeDeg, longitudeDeg: location.longitudeDeg }), path }));
    }
    const first = request.waypoints[0];
    if (request.initialServiceRequired)
        append('initial_service', 0, first, ROUTE_MODEL.groundPhaseSeconds);
    for (let i = 0; i < request.waypoints.length - 1; i++) {
        const from = request.waypoints[i], to = request.waypoints[i + 1];
        const path = greatCircle(from, to);
        distanceKm += path.distanceKm;
        append('preparation', i, from, ROUTE_MODEL.groundPhaseSeconds);
        const flight = createFlightPhases(cursor, from, to);
        phases.push(...flight.map(phase => Object.freeze({ ...phase, legIndex: i })));
        cursor = flight[flight.length - 1].endUtcMs;
        append('service', i, to, ROUTE_MODEL.groundPhaseSeconds);
    }
    return Object.freeze({ startUtcMs: request.startUtcMs, endUtcMs: cursor, distanceKm, phases: Object.freeze(phases) });
}
/** Flight phases without unrelated preparation or service timestamps. */
export function createFlightPhases(startUtcMs, from, to) {
    validateUtcMs(startUtcMs);
    const path = greatCircle(from, to);
    let cursor = startUtcMs;
    return ['takeoff', 'cruise', 'landing'].map(kind => {
        const start = cursor;
        cursor += (kind === 'cruise' ? path.distanceKm / ROUTE_MODEL.speedKmPerHour * 3600 : ROUTE_MODEL.groundPhaseSeconds) * 1000;
        validateUtcMs(cursor);
        return { kind, legIndex: 0, startUtcMs: start, endUtcMs: cursor,
            location: Object.freeze({ latitudeDeg: (kind === 'landing' ? to : from).latitudeDeg,
                longitudeDeg: (kind === 'landing' ? to : from).longitudeDeg }), path: kind === 'cruise' ? path : null };
    });
}
function phaseFraction(phase, utcMs) {
    if (!Number.isFinite(utcMs) || utcMs < phase.startUtcMs || utcMs > phase.endUtcMs) {
        throw new RangeError('UTC is outside the route phase.');
    }
    return phase.endUtcMs === phase.startUtcMs ? 0 : (utcMs - phase.startUtcMs) / (phase.endUtcMs - phase.startUtcMs);
}
export function routePhasePosition(phase, utcMs) {
    const fraction = phaseFraction(phase, utcMs);
    return phase.path ? greatCirclePosition(phase.path, fraction) : { ...phase.location };
}
export function routePhaseNormal(phase, utcMs) {
    const fraction = phaseFraction(phase, utcMs);
    return phase.path ? greatCircleNormal(phase.path, fraction) : surfaceNormal(phase.location);
}
function phaseQ(phase, utcMs) {
    const n = routePhaseNormal(phase, utcMs), s = solarDirection(utcMs);
    return Math.max(-1, Math.min(1, n[0] * s[0] + n[1] * s[1] + n[2] * s[2]));
}
/** Search a prefix without changing the trajectory of the original phase. */
export function checkRoutePhaseSafety(phase, options = {}, endUtcMs = phase.endUtcMs) {
    if (SOLAR_MODEL.version !== ROUTE_MODEL.solarModelVersion)
        throw new Error('Solar bounds need revalidation.');
    validateUtcMs(endUtcMs);
    if (endUtcMs < phase.startUtcMs || endUtcMs > phase.endUtcMs)
        throw new RangeError('Invalid phase cutoff.');
    const w = phase.path ? phase.path.angleRad / ((phase.endUtcMs - phase.startUtcMs) / 1000) : 0;
    const curvature = w * w + 2 * w * ROUTE_MODEL.solarSpeedBoundPerSecond + ROUTE_MODEL.solarCurvatureBoundPerSecond2;
    return searchSolarInterval(phase.startUtcMs, endUtcMs, t => phaseQ(phase, t), curvature, ROUTE_MODEL.evaluationErrorBound, options);
}
/** The single solar validator for both forecast and execution. */
export function checkRouteSafety(request, options = {}) {
    if (SOLAR_MODEL.version !== ROUTE_MODEL.solarModelVersion) {
        throw new Error('Solar model changed: revalidate route curvature bounds before use.');
    }
    const plan = createRoutePlan(request);
    const limits = searchLimits(options);
    let evaluations = 0;
    for (const phase of plan.phases) {
        const remaining = limits.maxEvaluations - evaluations;
        if (remaining < 4)
            return result('indeterminate', phase.startUtcMs, null, [phase.startUtcMs, phase.endUtcMs], 'evaluation_budget');
        const search = checkRoutePhaseSafety(phase, { ...options, maxEvaluations: remaining });
        evaluations += search.evaluations;
        if (search.status === 'indeterminate')
            return result(search.status, search.safeUntilUtcMs, null, search.bracket, search.reason);
        if (search.status === 'unsafe') {
            const time = search.witnessUtcMs;
            const bracket = search.bracket;
            const event = { utcMs: time, bracketUtcMs: bracket, timeErrorBoundSeconds: (bracket[1] - bracket[0]) / 1000,
                position: routePhasePosition(phase, time), phase: phase.kind, legIndex: phase.legIndex, q: phaseQ(phase, time) };
            return result('unsafe', search.safeUntilUtcMs, event, null, null);
        }
    }
    return result('safe', plan.endUtcMs, null, null, null);
    function result(status, safeUntilUtcMs, event, unresolvedIntervalUtcMs, reason) {
        return { status, modelVersion: ROUTE_MODEL.version, solarModelVersion: SOLAR_MODEL.version,
            configVersion: ROUTE_MODEL.configVersion, startUtcMs: plan.startUtcMs, endUtcMs: plan.endUtcMs,
            distanceKm: plan.distanceKm, safeUntilUtcMs, evaluations, reason, unresolvedIntervalUtcMs, event };
    }
}
/** Solar-only execution adapter: stop at the same event returned by forecasting.
 * Resource/state-machine execution is deliberately deferred to #5.
 */
export function executeSolarRoute(request, options = {}) {
    const safety = checkRouteSafety(request, options);
    const plan = createRoutePlan(request);
    const time = safety.event?.utcMs ?? safety.safeUntilUtcMs;
    const phase = plan.phases.find(p => time >= p.startUtcMs && time <= p.endUtcMs);
    return { outcome: safety.status === 'safe' ? 'completed' : safety.status === 'unsafe' ? 'solar_death' : 'needs_refinement',
        stoppedUtcMs: time, position: routePhasePosition(phase, time), safety };
}
