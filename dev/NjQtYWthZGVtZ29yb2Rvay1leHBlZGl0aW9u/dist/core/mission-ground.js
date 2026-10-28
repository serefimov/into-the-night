// SPDX-License-Identifier: GPL-3.0-only
import { greatCircle } from './geometry.js';
import { checkRoutePhaseSafety, routePhasePosition } from './route.js';
import { validateCoordinates } from './solar.js';
import { searchLimits } from './interval-search.js';
import { searchStationarySunrise } from './waiting.js';
import { validateUtcMs } from './time.js';
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
