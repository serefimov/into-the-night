import type { StandingForecast, WaitingOptions } from './waiting.js';
import type { RoutePhase } from './route.js';
import type { SearchOptions } from './interval-search.js';
import type { Coordinates } from './solar.js';
export declare const SIMULATION_CONFIG: Readonly<{
    version: 3;
    simulationVersion: "resources-resume-3";
    crew: 30;
    fuelCapacityKg: 18000;
    foodCapacityPersonHours: 2160;
    fuelKgPerKm: 3;
    fuelLoadingKgPerSecond: number;
    foodLoadingPersonHoursPerSecond: number;
    foodConsumptionPersonHoursPerSecond: number;
    achievementsDays: readonly number[];
}>;
export interface Stock {
    fuelKg: number;
    foodPersonHours: number;
}
export interface Airport extends Coordinates {
    id: string;
    stockBounds: {
        fuelKg: readonly [number, number];
        foodPersonHours: readonly [number, number];
    };
}
export interface World {
    scenarioId: string;
    scenarioVersion: number;
    seed: string;
    airports: readonly Airport[];
}
export type Action = {
    kind: 'load';
    fuelKg: number;
    foodPersonHours: number;
} | {
    kind: 'wait';
    seconds: number;
} | {
    kind: 'auto_wait';
    options?: WaitingOptions;
} | {
    kind: 'prepare';
} | {
    kind: 'service';
} | {
    kind: 'fly';
    destinationId: string;
};
export interface State {
    schemaVersion: 3;
    simulationVersion: string;
    configVersion: number;
    scenarioId: string;
    scenarioVersion: number;
    seed: string;
    startTimeUtc: number;
    currentTimeUtc: number;
    phase: 'planning' | 'simulating' | 'game_over';
    aircraft: Stock & {
        airportId: string | null;
        position: Coordinates;
        activeFlight: {
            from: string;
            to: string;
            stage: string;
            startUtcMs: number;
            endUtcMs: number;
        } | null;
    };
    stocks: Record<string, Stock>;
    discovered: string[];
    serviceRequired: boolean;
    departurePrepared: boolean;
    distanceKm: number;
    completedFlights: number;
    achievements: number[];
    activeAction: {
        action: Action;
        startedUtcMs: number;
        elapsedSeconds: number;
        transferred: Stock;
    } | null;
    waitingWarning: {
        issuedUtcMs: number;
        reasons: readonly string[];
        foodThresholdCrewHours: number;
        sunriseWarningHours: number;
    } | null;
    death: {
        reason: 'sun' | 'food' | 'fuel';
        utcMs: number;
    } | null;
}
export interface Event {
    kind: string;
    utcMs: number;
    detail: Record<string, unknown>;
}
export type PublicState = Omit<State, 'stocks'> & {
    warehouses: Record<string, Stock | Airport['stockBounds']>;
};
export type Outcome = 'completed' | 'waiting_stopped' | 'needs_discovery' | 'needs_refinement' | 'validation_error' | 'death' | 'risk_confirmation_required';
export interface Execution {
    outcome: Outcome;
    state: State;
    events: Event[];
    message: string | null;
    waiting: StandingForecast | null;
}
export interface Forecast {
    outcome: Outcome;
    state: PublicState;
    events: Event[];
    message: string | null;
    waiting: StandingForecast | null;
}
export declare function createSimulation(world: World, stocks: Record<string, Stock>, startUtcMs: number, airportId: string, aircraft: Stock, serviced?: boolean): State;
export declare function visibleState(world: World, state: State): PublicState;
/** Equality at the end of cruise is allowed; a deficit has an analytic event time. */
export declare function fuelExhaustionSeconds(fuelKg: number, distanceKm: number, durationSeconds: number): number | null;
export type TraceEntry = {
    kind: 'checkpoint';
    state: State;
    eventCount: number;
} | {
    kind: 'segment';
    before: State;
    after: State;
    phase: RoutePhase;
    eventsBefore: number;
    eventsAfter: number;
};
export interface ExecutionTrace {
    result: Execution;
    entries: readonly TraceEntry[];
}
export declare function forecastPlan(world: World, state: State, actions: readonly Action[], options?: SearchOptions): Forecast;
export declare function executePlan(world: World, state: State, actions: readonly Action[], options?: SearchOptions & {
    confirmRisk?: boolean;
}): Execution;
/** Internal engine trace; contains private state. UI uses a timeline's public views. */
export declare function tracePlan(world: World, state: State, actions: readonly Action[], options?: SearchOptions & {
    confirmRisk?: boolean;
}, mode?: 'forecast' | 'execute'): ExecutionTrace;
