// SPDX-License-Identifier: GPL-3.0-only
import { checkRoutePhaseSafety } from './route.js';
import { validateCoordinates } from './solar.js';
import { validateUtcMs } from './time.js';
/** Certify the whole stationary interval with the same solar model as flights.
 * An unsafe or indeterminate result must not be treated as permission to wait. */
export function forecastMissionWait(request, options = {}) {
    validateCoordinates(request.position);
    validateUtcMs(request.startUtcMs);
    validateUtcMs(request.endUtcMs);
    if (request.endUtcMs <= request.startUtcMs)
        throw new RangeError('Waiting must advance UTC');
    return checkRoutePhaseSafety({ kind: 'service', legIndex: 0, startUtcMs: request.startUtcMs,
        endUtcMs: request.endUtcMs, location: request.position, path: null }, options);
}
