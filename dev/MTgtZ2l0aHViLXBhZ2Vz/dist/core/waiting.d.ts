import type { SearchOptions, SearchResult } from './interval-search.js';
import type { Coordinates } from './solar.js';
export declare const WAITING_CONFIG: Readonly<{
    version: 1;
    horizonDays: 370;
    segmentDays: 30;
    foodThresholdCrewHours: 72;
    sunriseWarningHours: 12;
}>;
export interface WaitingOptions extends SearchOptions {
    readonly horizonDays?: number;
    readonly foodThresholdCrewHours?: number;
    readonly sunriseWarningHours?: number;
}
export interface SunriseSearch {
    readonly status: 'found' | 'not_found_within_horizon' | 'indeterminate';
    readonly startUtcMs: number;
    readonly requestedEndUtcMs: number;
    readonly searchedUntilUtcMs: number;
    readonly safeUntilUtcMs: number;
    readonly horizonEndUtcMs: number;
    readonly rangeLimited: boolean;
    readonly eventUtcMs: number | null;
    readonly bracketUtcMs: readonly [number, number] | null;
    readonly timeErrorBoundSeconds: number | null;
    readonly evaluations: number;
    readonly segments: number;
    readonly reason: SearchResult['reason'];
}
export interface StandingRequest {
    readonly position: Coordinates;
    readonly startUtcMs: number;
    readonly foodPersonHours: number;
    readonly crew: number;
}
export interface StandingForecast {
    readonly configVersion: number;
    readonly sunrise: SunriseSearch;
    readonly hungerUtcMs: number;
    readonly maximum: {
        readonly status: 'limited' | 'horizon_limited' | 'needs_refinement';
        readonly reason: 'food' | 'sun' | 'search_horizon' | 'uncertainty';
        /** Terminal boundary: survival at this timestamp is NOT promised. */
        readonly boundaryUtcMs: number;
        readonly seconds: number;
        readonly certifiedUntilUtcMs: number;
        readonly eventBracketUtcMs: readonly [number, number] | null;
    };
    readonly automatic: {
        readonly status: 'threshold' | 'search_horizon' | 'needs_refinement';
        readonly stopUtcMs: number;
        readonly seconds: number;
        readonly maximumRemainingSeconds: number | null;
        readonly reasons: readonly ('food_threshold' | 'sunrise_warning' | 'search_horizon' | 'uncertainty')[];
        readonly alreadyReached: boolean;
        readonly foodThresholdCrewHours: number;
        readonly sunriseWarningHours: number;
    };
}
/** Same conservative solar search as flight and execution, in sequential month-sized segments. */
export declare function searchStationarySunrise(position: Coordinates, startUtcMs: number, options?: WaitingOptions): SunriseSearch;
export declare function forecastStanding(request: StandingRequest, options?: WaitingOptions): StandingForecast;
