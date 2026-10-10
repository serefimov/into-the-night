import type { GreatCircle } from './geometry.js';
import type { Coordinates, Vector3 } from './solar.js';
import type { SearchOptions, SearchResult } from './interval-search.js';
export declare const ROUTE_MODEL: Readonly<{
    version: "great-circle-solar-1";
    configVersion: 1;
    solarModelVersion: "meeus-noaa-1";
    speedKmPerHour: 850;
    groundPhaseSeconds: 900;
    solarSpeedBoundPerSecond: 0.00008;
    solarCurvatureBoundPerSecond2: 8e-9;
    evaluationErrorBound: 1e-8;
}>;
export interface RouteRequest {
    readonly startUtcMs: number;
    readonly waypoints: readonly Coordinates[];
    readonly initialServiceRequired?: boolean;
}
export type RoutePhaseKind = 'initial_service' | 'preparation' | 'takeoff' | 'cruise' | 'landing' | 'service';
export interface RoutePhase {
    readonly kind: RoutePhaseKind;
    readonly legIndex: number;
    readonly startUtcMs: number;
    readonly endUtcMs: number;
    readonly location: Readonly<Coordinates>;
    readonly path: GreatCircle | null;
}
export interface RoutePlan {
    readonly startUtcMs: number;
    readonly endUtcMs: number;
    readonly distanceKm: number;
    readonly phases: readonly RoutePhase[];
}
export interface RouteSafety {
    readonly status: SearchResult['status'];
    readonly modelVersion: string;
    readonly solarModelVersion: string;
    readonly configVersion: number;
    readonly startUtcMs: number;
    readonly endUtcMs: number;
    readonly distanceKm: number;
    readonly safeUntilUtcMs: number;
    readonly evaluations: number;
    readonly reason: SearchResult['reason'];
    readonly unresolvedIntervalUtcMs: readonly [number, number] | null;
    readonly event: {
        readonly utcMs: number;
        readonly bracketUtcMs: readonly [number, number];
        readonly timeErrorBoundSeconds: number;
        readonly position: Coordinates;
        readonly phase: RoutePhaseKind;
        readonly legIndex: number;
        readonly q: number;
    } | null;
}
export declare function createRoutePlan(request: RouteRequest): RoutePlan;
/** Flight phases without unrelated preparation or service timestamps. */
export declare function createFlightPhases(startUtcMs: number, from: Coordinates, to: Coordinates): readonly RoutePhase[];
export declare function routePhasePosition(phase: RoutePhase, utcMs: number): Coordinates;
export declare function routePhaseNormal(phase: RoutePhase, utcMs: number): Vector3;
/** Search a prefix without changing the trajectory of the original phase. */
export declare function checkRoutePhaseSafety(phase: RoutePhase, options?: SearchOptions, endUtcMs?: number): SearchResult;
/** The single solar validator for both forecast and execution. */
export declare function checkRouteSafety(request: RouteRequest, options?: SearchOptions): RouteSafety;
/** Solar-only execution adapter: stop at the same event returned by forecasting.
 * Resource/state-machine execution is deliberately deferred to #5.
 */
export declare function executeSolarRoute(request: RouteRequest, options?: SearchOptions): {
    readonly outcome: 'completed' | 'solar_death' | 'needs_refinement';
    readonly stoppedUtcMs: number;
    readonly position: Coordinates;
    readonly safety: RouteSafety;
};
