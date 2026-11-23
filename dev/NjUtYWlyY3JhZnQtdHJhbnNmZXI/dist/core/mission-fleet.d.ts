import type { AircraftProfile } from './aircraft.js';
import type { MissionWorld } from './mission-flight.js';
export interface ParkedAircraft {
    id: string;
    profileId: string;
    airportId: string;
    fuelKg: number;
}
export interface FleetDefinition {
    initialAircraftId: string;
    transferSeconds: number;
    regionalProfiles: {
        profile: AircraftProfile;
        airportIds: string[];
    }[];
    parked: ParkedAircraft[];
}
export declare function validateFleet(world: MissionWorld, fleet: FleetDefinition): void;
export declare function aircraftWorld(world: MissionWorld, fleet: FleetDefinition, profileId: string): MissionWorld;
export declare function airportSuitable(world: MissionWorld, airport: MissionWorld['airports'][number]): boolean;
