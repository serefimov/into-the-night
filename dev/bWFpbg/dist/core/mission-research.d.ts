import { aircraftLeg, aircraftRefuelling } from './aircraft.js';
import type { AircraftProfile } from './aircraft.js';
import type { RoutePhase } from './route.js';
import type { SearchOptions, SearchResult } from './interval-search.js';
import type { Coordinates } from './solar.js';
export interface ResearchAirport extends Coordinates {
    id: string;
    suitability: {
        status: string;
    };
}
export interface ResearchState {
    airportId: string;
    utcMs: number;
    fuelKg: number;
    stocks: Record<string, number>;
    flights: number;
    distanceKm: number;
    won: boolean;
}
export interface ResearchWorld {
    profile: AircraftProfile;
    airports: readonly ResearchAirport[];
    targetId: string;
    targetCompletion?: 'arrival' | 'after_turnaround';
}
export interface ResearchPhase {
    label: 'departure' | 'cruise' | 'arrival' | 'service' | 'refuelling';
    route: RoutePhase;
}
export interface PhaseAudit {
    status: SearchResult['status'];
    evaluations: number;
    phase: ResearchPhase['label'] | null;
    eventUtcMs: number | null;
    bracketUtcMs: readonly [number, number] | null;
    safeUntilUtcMs: number;
    reason: SearchResult['reason'];
}
export interface ResearchForecast {
    allowed: boolean;
    reasons: readonly string[];
    distanceKm: number;
    arrivalUtcMs: number;
    endUtcMs: number;
    flight: ReturnType<typeof aircraftLeg>;
    refuelling: ReturnType<typeof aircraftRefuelling> | null;
    phases: readonly ResearchPhase[];
    solarScope: 'terminal_arrival' | 'automatic_turnaround' | 'flight_only_invalid_resources';
    solar: PhaseAudit;
    next: ResearchState | null;
}
export declare const RESEARCH_MODEL: Readonly<{
    version: "jfk-research-1";
    targetCompletion: "safe-end-of-arrival-before-service";
    initialGroundState: "ready-for-departure-phase";
}>;
export declare function validateResearchState(world: ResearchWorld, state: ResearchState): void;
export declare function auditResearchPhases(phases: readonly ResearchPhase[], options?: SearchOptions): PhaseAudit;
/** A research move exactly matches the prospective button: no waits or partial refuelling choices. */
export declare function forecastResearchFlight(world: ResearchWorld, state: ResearchState, destinationId: string, options?: SearchOptions): ResearchForecast;
/** Recompute and accept the same validated transition; rejected choices never mutate input. */
export declare function executeResearchFlight(world: ResearchWorld, state: ResearchState, destinationId: string, options?: SearchOptions): ResearchForecast;
/** All legal initial fuel lies in this closed interval. For a fixed destination,
 * solar flight timing is independent of fuel; maximum fuel minimizes compulsory
 * ground refuelling. Thus an unsafe upper-end trajectory rules out the interval
 * only when the audit locates actual Sun (not numerical uncertainty). */
export declare function firstFlightFuelEnvelope(world: ResearchWorld, fromId: string, toId: string): {
    minimumKg: number;
    maximumKg: number;
    feasible: boolean;
};
