/** Chronological adaptive search for the first q>=0.
 * Callers MUST provide a conservative |q''| bound (seconds) and evaluation error.
 * An interval is discarded only if max(q0,q1)+M*dt²/8+error<0.
 * Inconclusive leaves are kept: a later positive witness can only resolve them
 * if the entire first-event bracket is within the requested time tolerance.
 */
export interface SearchOptions {
    readonly eventToleranceSeconds?: number;
    readonly maxIntervalSeconds?: number;
    readonly maxEvaluations?: number;
}
export interface SearchResult {
    readonly status: 'safe' | 'unsafe' | 'indeterminate';
    readonly safeUntilUtcMs: number;
    readonly bracket: readonly [number, number] | null;
    readonly witnessUtcMs: number | null;
    readonly evaluations: number;
    readonly reason: 'near_horizon' | 'evaluation_budget' | null;
}
export interface SearchLimits {
    readonly toleranceMs: number;
    readonly maxIntervalMs: number;
    readonly maxEvaluations: number;
}
export declare function searchLimits(options?: SearchOptions): SearchLimits;
export declare function searchSolarInterval(startUtcMs: number, endUtcMs: number, valueAt: (utcMs: number) => number, curvaturePerSecond2: number, evaluationError: number, options?: SearchOptions): SearchResult;
