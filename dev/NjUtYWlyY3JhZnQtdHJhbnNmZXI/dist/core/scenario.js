import { SOLAR_MODEL } from './config.js';
import { ROUTE_MODEL } from './route.js';
import { SIMULATION_CONFIG, createSimulation } from './simulation.js';
import { parseUtc } from './time.js';
/** FNV-1a over UTF-16 code units, independently keyed by ID and resource.
 * No global PRNG cursor; catalog traversal cannot change a warehouse. */
function fraction(key) {
    let hash = 2166136261;
    for (let i = 0; i < key.length; i++)
        hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
    return hash / 4294967296;
}
export function generateScenario(catalog, scenario) {
    if (scenario.modelVersions?.simulationVersion !== SIMULATION_CONFIG.simulationVersion ||
        scenario.modelVersions?.configVersion !== SIMULATION_CONFIG.version ||
        scenario.modelVersions?.solarModelVersion !== SOLAR_MODEL.version ||
        scenario.modelVersions?.routeModelVersion !== ROUTE_MODEL.version || scenario.generatorVersion !== 1 || typeof scenario.seed !== 'string' || !scenario.seed ||
        typeof scenario.experimental !== 'boolean' || catalog.catalogId !== scenario.catalogId ||
        catalog.version !== scenario.catalogVersion || !Number.isInteger(catalog.version) || catalog.version < 1) {
        throw new RangeError('Incompatible scenario/catalog/generator.');
    }
    const airports = [], stocks = Object.create(null);
    for (const a of [...catalog.airports].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        if (!a.gameSuitable || !a.scheduledService || !a.runways.some(r => Number.isFinite(r.lengthM) &&
            r.lengthM >= 2000 && Number.isFinite(r.widthM) && r.widthM >= 45 && r.surface === 'asphalt')) {
            throw new RangeError('Airport does not satisfy the documented game suitability assumption.');
        }
        const bounds = scenario.resourceBounds[a.id];
        if (!bounds)
            throw new RangeError('Missing resource bounds.');
        const stock = { fuelKg: 0, foodPersonHours: 0 };
        for (const resource of ['fuelKg', 'foodPersonHours']) {
            const pair = bounds[resource];
            if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(pair[0]) || !Number.isSafeInteger(pair[1]) ||
                pair[0] < 0 || pair[1] < pair[0] || !Number.isSafeInteger(pair[1] - pair[0] + 1))
                throw new RangeError('Invalid stock range.');
            const key = JSON.stringify([scenario.generatorVersion, scenario.scenarioId, scenario.scenarioVersion, scenario.seed, a.id, resource]);
            stock[resource] = pair[0] + Math.floor(fraction(key) * (pair[1] - pair[0] + 1));
        }
        airports.push({ id: a.id, latitudeDeg: a.latitudeDeg, longitudeDeg: a.longitudeDeg,
            stockBounds: { fuelKg: [...bounds.fuelKg], foodPersonHours: [...bounds.foodPersonHours] } });
        stocks[a.id] = stock;
    }
    if (Object.keys(scenario.resourceBounds).length !== airports.length)
        throw new RangeError('Resource bounds must match the catalog.');
    const world = { scenarioId: scenario.scenarioId, scenarioVersion: scenario.scenarioVersion, seed: scenario.seed, airports };
    // Reuse kernel validation for coordinates, duplicate IDs, resources, UTC and starting state.
    createSimulation(world, stocks, parseUtc(scenario.utc), scenario.airportId, scenario.aircraft, scenario.serviced);
    return { world, stocks };
}
