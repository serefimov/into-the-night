import type { Catalog, Scenario } from './scenario.js';
import type { Action, PublicState, Forecast, Event } from './simulation.js';
import type { TimelineView, SessionAdvance } from './sessions.js';
import type { StandingForecast, SunriseSearch } from './waiting.js';
import type { SolarExposure } from './solar.js';
export interface GameJournal {
    journalVersion: number;
    scenarioId: string;
    scenarioVersion: number;
    seed: string;
    simulationVersion: string;
    configVersion: number;
    solarModelVersion: string;
    routeModelVersion: string;
    entries: {
        actions: readonly Action[];
        confirmRisk: boolean;
        startUtcMs: number;
        stopUtcMs: number;
        cancelGround: boolean;
        active: boolean;
        events: Event[];
    }[];
    state: PublicState;
}
export interface FlightPreview {
    actions: Action[];
    forecast: Forecast;
    distanceKm: number;
    arrivalUtcMs: number;
    durationSeconds: number;
    arrivalSolar: SolarExposure;
    sunrise: SunriseSearch;
}
/** Browser/CLI game adapter. Only public projections leave normal gameplay methods.
 * Private state crosses the boundary solely in explicitly exported saves. */
export declare class SpikeGame {
    #private;
    constructor(catalog: Catalog, scenario: Scenario);
    get active(): boolean;
    get endUtcMs(): number;
    current(): PublicState;
    forecast(actions: readonly Action[]): Forecast;
    preview(actions: readonly Action[], utcMs: number): TimelineView;
    flight(destinationId: string): FlightPreview;
    standing(): StandingForecast;
    start(actions: readonly Action[], confirmRisk?: boolean): void;
    advance(utcMs: number): SessionAdvance;
    /** End an unfinished ground action at the already committed cursor. Flags are
     * left as calculated: interrupted preparation/service is not completed. */
    cancelGround(): void;
    save(): string;
    restore(text: string): void;
    journal(): GameJournal;
}
