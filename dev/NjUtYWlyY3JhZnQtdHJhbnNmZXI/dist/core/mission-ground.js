// SPDX-License-Identifier: GPL-3.0-only
import { greatCircle } from './geometry.js';
import { checkRoutePhaseSafety, routePhasePosition } from './route.js';
import { validateCoordinates } from './solar.js';
import { searchLimits } from './interval-search.js';
import { searchStationarySunrise } from './waiting.js';
import { validateUtcMs } from './time.js';
import { forecastMissionFlight } from './mission-flight.js';
import { availabilityReason } from './mission-availability.js';
import { airportSuitable } from './mission-fleet.js';
import { departureWindowSteps } from './departure-window.js';
const equal = (a, b) => a.latitudeDeg === b.latitudeDeg && a.longitudeDeg === b.longitudeDeg;
export function validateChapterOne(d, airport) {
    if (d.version !== 1 || d.id !== 'akademgorodok-expedition-v1' || d.knowledgeId !== 'akademgorodok' || typeof d.siteName !== 'string' || !d.siteName)
        throw new RangeError('Invalid chapter one definition');
    for (const value of [d.outboundSeconds, d.acquisitionSeconds, d.returnSeconds])
        if (!Number.isFinite(value) || value <= 0)
            throw new RangeError('Ground durations must be positive');
    for (const path of [d.outbound, d.inbound]) {
        if (!Array.isArray(path) || path.length < 2 || path.length > 5000)
            throw new RangeError('Invalid ground path');
        path.forEach(validateCoordinates);
        for (let i = 1; i < path.length; i++)
            greatCircle(path[i - 1], path[i]);
    }
    if (!equal(d.outbound[0], airport) || !equal(d.inbound.at(-1), airport) || !equal(d.outbound.at(-1), d.inbound[0]))
        throw new RangeError('Ground endpoints differ');
}
/** Roads are frozen OSM polylines; each short arc shares the flight solar solver.
 * No vehicle speed, sunlight exemption, fuel refill or resource reset is implied. */
export function forecastChapterOne(d, startUtcMs, options = {}) {
    validateUtcMs(startUtcMs);
    const phases = [];
    let cursor = startUtcMs;
    function road(label, points, seconds) {
        const paths = points.slice(1).map((to, i) => greatCircle(points[i], to)), total = paths.reduce((sum, p) => sum + p.distanceKm, 0), start = cursor;
        let travelled = 0;
        for (const [i, path] of paths.entries()) {
            travelled += path.distanceKm;
            const end = i === paths.length - 1 ? start + seconds * 1000 : start + seconds * 1000 * travelled / total;
            phases.push({ label, route: { kind: 'cruise', legIndex: 0, startUtcMs: cursor, endUtcMs: end, location: points[i], path } });
            cursor = end;
        }
    }
    road('ground_outbound', d.outbound, d.outboundSeconds);
    const site = d.outbound.at(-1);
    phases.push({ label: 'ground_acquisition', route: { kind: 'service', legIndex: 0, startUtcMs: cursor, endUtcMs: cursor + d.acquisitionSeconds * 1000, location: site, path: null } });
    cursor += d.acquisitionSeconds * 1000;
    const acquiredUtcMs = cursor;
    road('ground_return', d.inbound, d.returnSeconds);
    validateUtcMs(cursor);
    const limit = searchLimits(options);
    let evaluations = 0;
    let solar = { status: 'safe', safeUntilUtcMs: cursor, bracket: null, witnessUtcMs: null, evaluations: 0, reason: null, stage: null, position: null };
    for (const p of phases) {
        const remaining = limit.maxEvaluations - evaluations;
        if (remaining < 4) {
            solar = { status: 'indeterminate', safeUntilUtcMs: p.route.startUtcMs, bracket: [p.route.startUtcMs, p.route.endUtcMs], witnessUtcMs: null, evaluations, reason: 'evaluation_budget', stage: p.label, position: null };
            break;
        }
        const audit = checkRoutePhaseSafety(p.route, { ...options, maxEvaluations: remaining });
        evaluations += audit.evaluations;
        if (audit.status !== 'safe') {
            solar = { ...audit, evaluations, stage: p.label, position: audit.witnessUtcMs === null ? null : routePhasePosition(p.route, audit.witnessUtcMs) };
            break;
        }
    }
    solar = { ...solar, evaluations };
    const parked = { kind: 'service', legIndex: 0, startUtcMs, endUtcMs: cursor, location: d.outbound[0], path: null };
    const parkedSolar = checkRoutePhaseSafety(parked, options), airportRise = searchStationarySunrise(parked.location, startUtcMs, options), siteRise = searchStationarySunrise(site, startUtcMs, options);
    const airportSunriseUtcMs = airportRise.status === 'found' ? airportRise.eventUtcMs : null, siteSunriseUtcMs = siteRise.status === 'found' ? siteRise.eventUtcMs : null;
    const reasons = [];
    if (solar.status !== 'safe')
        reasons.push(solar.status === 'unsafe' ? 'ground_sun' : 'ground_indeterminate');
    if (parkedSolar.status !== 'safe')
        reasons.push(parkedSolar.status === 'unsafe' ? 'parked_plane_sun' : 'parked_plane_indeterminate');
    return { allowed: reasons.length === 0, reasons, startUtcMs, acquiredUtcMs, endUtcMs: cursor, phases, solar, parkedSolar, airportSunriseUtcMs, siteSunriseUtcMs, returnMarginSeconds: airportSunriseUtcMs === null ? null : (airportSunriseUtcMs - cursor) / 1000 };
}
/** Certify one action from the actual post-expedition state. Ground travel
 * advances UTC only, so dispatch still sees the aircraft's fuel and stocks. */
export function forecastExpedition(world, origin, options = {}) {
    const chapter = world.chapterOne;
    if (!chapter || origin.airportId !== chapter.airportId)
        throw new RangeError('Invalid expedition origin');
    const ground = forecastChapterOne(chapter, origin.utcMs, options);
    if (!ground.allowed)
        return { ...ground, onward: null };
    const onward = findOnwardDeparture(world, { ...origin, utcMs: ground.endUtcMs }, options);
    const allowed = onward.status === 'available';
    return { ...ground, onward, allowed, reasons: allowed ? [] : ['onward_' + onward.status] };
}
function findOnwardDeparture(world, state, options) {
    const candidates = [];
    let uncertain = false;
    const budget = searchLimits(options).maxEvaluations;
    let evaluations = 0;
    for (const airport of world.airports) {
        if (airport.id === state.airportId || !airportSuitable(world, airport))
            continue;
        const remaining = budget - evaluations;
        if (remaining < 4)
            return { status: 'indeterminate' };
        let forecast;
        try {
            forecast = forecastMissionFlight(world, state, airport.id, { ...options, maxEvaluations: remaining });
        }
        catch (error) {
            if (error instanceof RangeError && /Coincident|antipodal/.test(error.message))
                continue;
            if (error instanceof RangeError && error.message.startsWith('UTC must')) {
                uncertain = true;
                continue;
            }
            throw error;
        }
        evaluations += forecast.solar.evaluations;
        if (forecast.allowed)
            return { status: 'available', destinationId: airport.id, startUtcMs: state.utcMs };
        if (['sun', 'unresolved'].includes(availabilityReason(forecast)))
            candidates.push({ id: airport.id, forecast });
    }
    for (const { id, forecast } of candidates) {
        const remaining = budget - evaluations;
        if (remaining < 4)
            return { status: 'indeterminate' };
        // The immediate check is already charged to the shared budget above.
        const steps = departureWindowSteps(world, state, id, { allowed: forecast.allowed, reasons: forecast.reasons, forecast }, { ...options, maxEvaluations: remaining + forecast.solar.evaluations });
        let step = steps.next();
        while (!step.done)
            step = steps.next();
        const window = step.value;
        evaluations += window.evaluations - forecast.solar.evaluations;
        if (window.status === 'waiting' && window.startUtcMs !== null)
            return { status: 'available', destinationId: id, startUtcMs: window.startUtcMs };
        if (window.status === 'indeterminate' || window.limit === 'range')
            uncertain = true;
    }
    return { status: uncertain ? 'indeterminate' : 'not_found' };
}
