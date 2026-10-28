import type { RoutePhase } from './route.js';
import type { Coordinates } from './solar.js';
import type { SearchOptions, SearchResult } from './interval-search.js';
export interface ChapterOneDefinition {
    version: 1;
    id: string;
    airportId: string;
    siteName: string;
    knowledgeId: 'akademgorodok';
    outbound: Coordinates[];
    inbound: Coordinates[];
    outboundSeconds: number;
    acquisitionSeconds: number;
    returnSeconds: number;
}
export type GroundStage = 'ground_outbound' | 'ground_acquisition' | 'ground_return';
export interface GroundPhase {
    label: GroundStage;
    route: RoutePhase;
}
export interface GroundForecast {
    allowed: boolean;
    reasons: string[];
    startUtcMs: number;
    acquiredUtcMs: number;
    endUtcMs: number;
    phases: GroundPhase[];
    solar: SearchResult & {
        stage: GroundStage | null;
        position: Coordinates | null;
    };
    parkedSolar: SearchResult;
    airportSunriseUtcMs: number | null;
    siteSunriseUtcMs: number | null;
    returnMarginSeconds: number | null;
}
export declare function validateChapterOne(d: ChapterOneDefinition, airport: Coordinates): void;
/** Roads are frozen OSM polylines; each short arc shares the flight solar solver.
 * No vehicle speed, sunlight exemption, fuel refill or resource reset is implied. */
export declare function forecastChapterOne(d: ChapterOneDefinition, startUtcMs: number, options?: SearchOptions): GroundForecast;
