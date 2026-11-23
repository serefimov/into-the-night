import type { MissionWorld, MissionForecast } from './mission-flight.js';
import type { ResearchState } from './mission-research.js';
import type { SearchOptions } from './interval-search.js';
export declare const DEPARTURE_SEARCH: Readonly<{
    horizonSeconds: 86400;
    stepSeconds: 900;
    defaultMaxEvaluations: number;
}>;
export interface DepartureWindow {
    status: 'now' | 'waiting' | 'blocked' | 'not_found' | 'indeterminate';
    startUtcMs: number | null;
    forecast: MissionForecast | null;
    horizonEndUtcMs: number;
    stepSeconds: number;
    checked: number;
    evaluations: number;
    limit: 'horizon' | 'sunrise' | 'budget' | 'range' | null;
    earlierUncertain: boolean;
}
/** Chronological finite grid. Yields after each candidate so worker/fallback can
 * cooperate with cancellation and input. It never mutates the mission. */
export declare function departureWindowSteps(world: MissionWorld, state: ResearchState, toId: string, immediate: {
    allowed: boolean;
    reasons: readonly string[];
    forecast: MissionForecast | null;
}, options?: SearchOptions): Generator<void, DepartureWindow>;
