export function searchLimits(options = {}) {
    const tolerance = options.eventToleranceSeconds ?? 0.5;
    const interval = options.maxIntervalSeconds ?? 900;
    const evaluations = options.maxEvaluations ?? 100000;
    if (!Number.isFinite(tolerance) || tolerance < 0.01 || tolerance > 1 ||
        !Number.isFinite(interval) || interval <= 0 || interval > 86400 ||
        !Number.isInteger(evaluations) || evaluations < 4 || evaluations > 1000000) {
        throw new RangeError('Search requires tolerance 0.01..1 s, interval (0,86400] s and 4..1000000 evaluations.');
    }
    return { toleranceMs: tolerance * 1000, maxIntervalMs: interval * 1000, maxEvaluations: evaluations };
}
export function searchSolarInterval(startUtcMs, endUtcMs, valueAt, curvaturePerSecond2, evaluationError, options = {}) {
    const limits = searchLimits(options);
    if (!Number.isFinite(startUtcMs) || !Number.isFinite(endUtcMs) || endUtcMs < startUtcMs ||
        !Number.isFinite(curvaturePerSecond2) || curvaturePerSecond2 < 0 ||
        !Number.isFinite(evaluationError) || evaluationError < 0) {
        throw new RangeError('Invalid interval or numerical bounds.');
    }
    let evaluations = 0;
    let uncertainFrom = null;
    let result = null;
    const cache = new Map();
    function output(status, from, to, witness, reason) {
        return { status, safeUntilUtcMs: from, bracket: status === 'safe' ? null : [from, to],
            witnessUtcMs: witness, evaluations, reason };
    }
    function value(time) {
        const existing = cache.get(time);
        if (existing !== undefined)
            return existing;
        if (evaluations >= limits.maxEvaluations)
            return undefined;
        const q = valueAt(time);
        if (!Number.isFinite(q))
            throw new RangeError('Non-finite solar evaluation.');
        cache.set(time, q);
        evaluations++;
        return q;
    }
    function visit(lo, hi) {
        if (result)
            return;
        if (uncertainFrom !== null && hi - uncertainFrom > limits.toleranceMs) {
            hi = Math.min(hi, uncertainFrom + limits.toleranceMs);
            if (lo >= hi) {
                result = output('indeterminate', uncertainFrom, hi, null, 'near_horizon');
                return;
            }
        }
        const a = value(lo), b = value(hi);
        if (a === undefined || b === undefined) {
            result = output('indeterminate', uncertainFrom ?? lo, hi, null, 'evaluation_budget');
            return;
        }
        if (a >= 0) {
            result = output('unsafe', uncertainFrom ?? lo, lo, lo, null);
            return;
        }
        const seconds = (hi - lo) / 1000;
        const upper = Math.max(a, b) + curvaturePerSecond2 * seconds * seconds / 8 + evaluationError;
        if (upper < 0)
            return;
        const mid = lo + (hi - lo) / 2;
        if (hi - lo <= limits.toleranceMs / 32 || mid === lo || mid === hi) {
            uncertainFrom ??= lo;
            if (b >= 0)
                result = output('unsafe', uncertainFrom, hi, hi, null);
            return;
        }
        visit(lo, mid);
        visit(mid, hi);
    }
    if (startUtcMs === endUtcMs) {
        const q = value(startUtcMs);
        return q !== undefined && q >= 0
            ? output('unsafe', startUtcMs, startUtcMs, startUtcMs, null)
            : output('safe', endUtcMs, endUtcMs, null, null);
    }
    for (let lo = startUtcMs; lo < endUtcMs && !result;) {
        const hi = Math.min(endUtcMs, lo + limits.maxIntervalMs);
        if (hi <= lo)
            throw new RangeError('Search interval is below timestamp resolution.');
        visit(lo, hi);
        lo = hi;
        if (!result && uncertainFrom !== null && (hi - uncertainFrom >= limits.toleranceMs || hi === endUtcMs)) {
            result = output('indeterminate', uncertainFrom, Math.min(hi, uncertainFrom + limits.toleranceMs), null, 'near_horizon');
        }
    }
    return result ?? output('safe', endUtcMs, endUtcMs, null, null);
}
