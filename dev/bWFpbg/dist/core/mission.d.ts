import type { MissionWorld, MissionForecast } from './mission-flight.js';
import type { ResearchPhase } from './mission-research.js';
import type { Coordinates } from './solar.js';
import type { SearchOptions } from './interval-search.js';
export declare const MISSION_MODEL: Readonly<{
    readonly mode: "airport-flight-v2";
    readonly simulationVersion: "flight-cycle-2";
    readonly schemaVersion: 2;
    readonly eventVersion: 2;
    readonly saveVersion: 2;
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
    version: 2;
    sequence: number;
    utcMs: number;
    flightIndex: number;
    airportId: string;
    kind: 'mission_started' | 'flight_committed' | 'flight_started' | 'arrived' | 'refuelling_started' | 'flight_completed' | 'mission_won' | 'mission_died';
}
export interface MissionState {
    mode: typeof MISSION_MODEL.mode;
    schemaVersion: 2;
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
    status: 'running' | 'won' | 'dead';
    phase: 'planning' | 'won' | 'dead' | ResearchPhase['label'];
    death: null | {
        kind: 'sun';
        utcMs: number;
    };
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
    forecast(destinationId: string): MissionChoice;
    fly(destinationId: string): MissionChoice;
    /** Explicit analysis for UI/CLI. A planning dead end never advances UTC or causes an invented death. */
    availability(): {
        status: 'available' | 'no_safe_choices' | 'unresolved' | 'busy' | 'terminal';
        availableIds: string[];
        unresolvedIds: string[];
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
