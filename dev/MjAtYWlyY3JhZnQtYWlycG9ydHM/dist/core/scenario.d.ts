import type { Airport, Stock, World } from './simulation.js';
export interface CatalogAirport {
    id: string;
    latitudeDeg: number;
    longitudeDeg: number;
    gameSuitable: boolean;
    scheduledService: boolean;
    runways: readonly {
        lengthM: number;
        widthM: number;
        surface: string;
    }[];
}
export interface Catalog {
    catalogId: string;
    version: number;
    airports: readonly CatalogAirport[];
}
export interface Scenario {
    scenarioId: string;
    scenarioVersion: number;
    experimental: boolean;
    catalogId: string;
    catalogVersion: number;
    generatorVersion: 1;
    seed: string;
    utc: string;
    airportId: string;
    aircraft: Stock;
    serviced: boolean;
    resourceBounds: Record<string, Airport['stockBounds']>;
    modelVersions: {
        simulationVersion: string;
        configVersion: number;
        solarModelVersion: string;
        routeModelVersion: string;
    };
}
export declare function generateScenario(catalog: Catalog, scenario: Scenario): {
    world: World;
    stocks: Record<string, Stock>;
};
