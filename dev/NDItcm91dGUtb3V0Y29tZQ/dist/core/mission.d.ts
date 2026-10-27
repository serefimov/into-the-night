import type { MissionWorld, MissionForecast } from './mission-flight.js';
import type { ResearchPhase } from './mission-research.js';
import type { Coordinates } from './solar.js';
import type { SearchOptions } from './interval-search.js';
import type { MissionAvailability, AvailabilityReason } from './mission-availability.js';
export declare const MISSION_MODEL: Readonly<{
    readonly mode: "airport-flight-v3";
    readonly simulationVersion: "flight-cycle-3";
    readonly schemaVersion: 3;
    readonly eventVersion: 3;
    readonly saveVersion: 3;
}>;
export interface MissionDefinition extends MissionWorld {
    scenarioId: string;
    scenarioVersion: number;
    seed: string;
    stockVersion: string;
    worldVersion: string;
    targetCompletion: 'arrival' | 'after_service';
    initial: {
        airportId: string;
        utcMs: number;
        fuelKg: number;
        stocks: Record<string, number>;
    };
}
export interface MissionEvent {
    version: 3;
    sequence: number;
    utcMs: number;
    flightIndex: number;
    airportId: string;
    kind: 'mission_started' | 'flight_committed' | 'flight_started' | 'arrived' | 'refuelling_started' | 'flight_completed' | 'mission_won' | 'mission_died' | 'mission_lost';
}
export interface MissionState {
    mode: typeof MISSION_MODEL.mode;
    schemaVersion: 3;
    simulationVersion: string;
    scenarioId: string;
    scenarioVersion: number;
    seed: string;
    stockVersion: string;
    worldVersion: string;
    startUtcMs: number;
    utcMs: number;
    airportId: string | null;
    position: Coordinates;
    fuelKg: number;
    stocks: Record<string, number>;
    flights: number;
    distanceKm: number;
    status: 'running' | 'won' | 'dead' | 'lost';
    phase: 'planning' | 'won' | 'dead' | 'lost' | ResearchPhase['label'];
    death: null | {
        kind: 'sun';
        utcMs: number;
    };
    result: MissionResult | null;
    activeFlight: null | {
        fromId: string;
        toId: string;
        startUtcMs: number;
        departureUtcMs: number;
        arrivalUtcMs: number;
        endUtcMs: number;
        phaseStartUtcMs: number;
        phaseEndUtcMs: number;
    };
}
export type MissionResult = {
    kind: 'goal' | 'sun';
    utcMs: number;
} | {
    kind: 'no_routes';
    utcMs: number;
    checked: number;
    total: number;
    reasons: Record<AvailabilityReason, number>;
};
export interface MissionView {
    state: MissionState;
    events: MissionEvent[];
}
export interface MissionAdvance extends MissionView {
    newEvents: MissionEvent[];
}
export interface MissionChoice {
    allowed: boolean;
    reasons: readonly string[];
    forecast: MissionForecast | null;
}
/** A no-food, no-wait session. The shared departure-fuel transition supplies every accepted physical plan. */
export declare class MissionSession {
    #private;
    constructor(definition: MissionDefinition, options?: SearchOptions);
    get definition(): MissionDefinition;
    get currentTimeUtc(): number;
    get endUtcMs(): number;
    get planningKey(): string | null;
    forecast(destinationId: string): MissionChoice;
    fly(destinationId: string): MissionChoice;
    /** Pure, complete analysis: it never changes time, resources, result or event delivery. */
    availability(): MissionAvailability;
    /** Only the session's own full-catalog forecasts can commit a no-routes result.
     * Worker counts are progress, never authority to end a party. No-wait policy (#25 revises it). */
    resolvePlanning(): MissionAdvance & {
        availability: MissionAvailability;
    };
    /** Preview may inspect accepted history/future, but never commits time, fuel or event delivery. */
    stateAt(utcMs: number): MissionView;
    current(): MissionView;
    stopAt(utcMs: number): MissionAdvance;
    resume(): MissionAdvance;
    save(): string;
    /** Separate format: historical survival saves are rejected rather than reinterpreted as food-free missions. */
    static restore(serialized: string, expectedDefinition?: MissionDefinition): MissionSession;
}
