import type { GroundForecast, GroundStage } from './mission-ground.js';
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
    readonly saveVersion: 5;
    readonly waitingVersion: 1;
}>;
export declare const CAMPAIGN_MODEL: Readonly<{
    readonly mode: "campaign-ground-v1";
    readonly simulationVersion: "flight-ground-1";
    readonly schemaVersion: 4;
    readonly eventVersion: 4;
    readonly saveVersion: 6;
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
    version: 3 | 4;
    sequence: number;
    utcMs: number;
    flightIndex: number;
    airportId: string;
    kind: 'mission_started' | 'flight_committed' | 'flight_started' | 'arrived' | 'refuelling_started' | 'flight_completed' | 'mission_won' | 'mission_died' | 'mission_lost' | 'waiting_started' | 'waiting_completed' | 'expedition_started' | 'knowledge_acquired' | 'chapter_completed';
}
export interface MissionState {
    mode: typeof MISSION_MODEL.mode | typeof CAMPAIGN_MODEL.mode;
    schemaVersion: 3 | 4;
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
    phase: GroundStage | 'waiting' | 'planning' | 'won' | 'dead' | 'lost' | ResearchPhase['label'];
    death: null | {
        kind: 'sun';
        utcMs: number;
    };
    result: MissionResult | null;
    campaign?: {
        chapterOneCompleted: boolean;
        knowledgeIds: ('akademgorodok')[];
        objective: 'akademgorodok' | 'tsukuba';
        playerLocation: 'aircraft' | 'ground';
    };
    aircraft?: {
        airportId: string | null;
        position: Coordinates;
    };
    activeGround?: {
        startUtcMs: number;
        acquiredUtcMs: number;
        endUtcMs: number;
        stage: GroundStage;
    };
    activeWait?: {
        startUtcMs: number;
        endUtcMs: number;
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
export interface GroundChoice {
    allowed: boolean;
    reasons: readonly string[];
    forecast: GroundForecast | null;
}
export interface MissionAcceptedFlight {
    fromId: string;
    toId: string;
    forecast: MissionForecast;
}
/** A food-free session with explicitly certified parked waits. The shared departure-fuel transition supplies every accepted physical plan. */
export declare class MissionSession {
    #private;
    constructor(definition: MissionDefinition, options?: SearchOptions);
    get model(): Readonly<{
        readonly mode: "airport-flight-v3";
        readonly simulationVersion: "flight-cycle-3";
        readonly schemaVersion: 3;
        readonly eventVersion: 3;
        readonly saveVersion: 5;
        readonly waitingVersion: 1;
    }> | Readonly<{
        readonly mode: "campaign-ground-v1";
        readonly simulationVersion: "flight-ground-1";
        readonly schemaVersion: 4;
        readonly eventVersion: 4;
        readonly saveVersion: 6;
    }>;
    get definition(): MissionDefinition;
    get currentTimeUtc(): number;
    /** Read-only-by-copy accepted plans, for presenting history and resuming playback. */
    get acceptedFlights(): MissionAcceptedFlight[];
    get endUtcMs(): number;
    get planningKey(): string | null;
    forecastExpedition(): GroundChoice;
    startExpedition(): GroundChoice;
    waitingLimit(): import("./waiting.js").SunriseSearch;
    /** Read-only solar certification; accepting and executing a wait is separate. */
    forecastWait(endUtcMs: number): import("./interval-search.js").SearchResult;
    departureWindowSteps(destinationId: string): Generator<void, import("./departure-window.js").DepartureWindow, any>;
    departureWindow(destinationId: string): import("./departure-window.js").DepartureWindow;
    get waitingDestinationId(): string | null;
    waitForDeparture(destinationId: string, startUtcMs: number): boolean;
    /** Accept only an entirely certified interval. No resources change on a parked wait. */
    waitUntil(endUtcMs: number): import("./interval-search.js").SearchResult;
    /** End a wait at the actual cursor; the discarded remainder is not executed. */
    cancelWait(): MissionAdvance;
    forecast(destinationId: string): MissionChoice;
    fly(destinationId: string): MissionChoice;
    /** Pure, complete analysis: it never changes time, resources, result or event delivery. */
    availability(): MissionAvailability;
    /** Only the session's own full-catalog forecasts can commit a no-routes result.
     * Worker counts are progress, never authority to end a party. Only time-independent blocks establish a dead end without departure-window analysis. */
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
