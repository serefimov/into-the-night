import type { SearchOptions, SearchResult } from './interval-search.js';
import type { Coordinates } from './solar.js';
export interface MissionWaitRequest {
    readonly position: Coordinates;
    readonly startUtcMs: number;
    readonly endUtcMs: number;
}
/** Certify the whole stationary interval with the same solar model as flights.
 * An unsafe or indeterminate result must not be treated as permission to wait. */
export declare function forecastMissionWait(request: MissionWaitRequest, options?: SearchOptions): SearchResult;
