import { aircraftLeg, aircraftRefuelling } from './aircraft.js';
import type { ResearchWorld, ResearchState, ResearchPhase, PhaseAudit } from './mission-research.js';
import type { SearchOptions } from './interval-search.js';
export interface MissionWorld extends Omit<ResearchWorld, 'targetCompletion'> {
    targetCompletion: 'arrival' | 'after_service';
}
export interface MissionForecast {
    allowed: boolean;
    reasons: readonly string[];
    distanceKm: number;
    departureUtcMs: number;
    arrivalUtcMs: number;
    endUtcMs: number;
    flight: ReturnType<typeof aircraftLeg>;
    refuelling: ReturnType<typeof aircraftRefuelling> & {
        airportId: string;
        neededKg: number;
        requiredFuelKg: number;
        sufficient: boolean;
    };
    phases: readonly ResearchPhase[];
    solar: PhaseAudit;
    solarScope: 'departure_and_flight' | 'departure_flight_service' | 'invalid_resources';
    next: ResearchState | null;
}
/** New dispatch policy only. Historical research transitions remain tied to their original rules. */
export declare function forecastMissionFlight(world: MissionWorld, state: ResearchState, destinationId: string, options?: SearchOptions): MissionForecast;
