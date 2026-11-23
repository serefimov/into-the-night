import type { Action, Event, Outcome, PublicState, State, World } from './simulation.js';
import type { SearchOptions } from './interval-search.js';
import type { StandingForecast } from './waiting.js';
export interface TimelineView {
    outcome: 'paused' | Outcome;
    requestedUtcMs: number;
    state: PublicState;
    /** Complete historical journal at this time; read-only views do not dispatch events. */
    events: Event[];
    waiting: StandingForecast | null;
}
export interface SessionAdvance extends TimelineView {
    newEvents: Event[];
}
export type SessionOptions = SearchOptions & {
    confirmRisk?: boolean;
};
export declare class SessionError extends Error {
    readonly outcome: Outcome;
    constructor(outcome: Outcome, message: string);
}
export declare function copy<T>(value: T): T;
export declare class ForecastTimeline {
    #private;
    constructor(world: World, state: State, actions: readonly Action[], options?: SearchOptions);
    get endUtcMs(): number;
    stateAt(utcMs: number): TimelineView;
}
export interface SavePayload {
    schemaVersion: 3;
    simulationVersion: string;
    configVersion: number;
    scenarioId: string;
    scenarioVersion: number;
    seed: string;
    world: World;
    origin: State;
    actions: readonly Action[];
    options: SessionOptions;
    cursorUtcMs: number;
    consumedEvents: number;
    snapshot: State;
    journal: Event[];
}
export declare class SimulationSession {
    #private;
    constructor(world: World, state: State, actions: readonly Action[], options?: SessionOptions);
    get endUtcMs(): number;
    get currentTimeUtc(): number;
    stateAt(utcMs: number): TimelineView;
    current(): TimelineView;
    stopAt(utcMs: number): SessionAdvance;
    resume(): SessionAdvance;
    /** Private save data, not a UI projection; consumedEvents is the event-delivery cursor. */
    savePayload(): SavePayload;
    /** Used only after save validation; no resources or events are replayed into the snapshot. */
    restoreCursor(cursorUtcMs: number, consumedEvents: number): void;
}
