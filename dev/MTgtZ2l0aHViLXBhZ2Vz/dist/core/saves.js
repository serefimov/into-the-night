import { SIMULATION_CONFIG } from './simulation.js';
import { SimulationSession, SessionError } from './sessions.js';
import { validateCoordinates } from './solar.js';
import { validateUtcMs } from './time.js';
import { searchLimits } from './interval-search.js';
export const SAVE_FORMAT_VERSION = 1;
/** Stable JSON key order, independent of object insertion order and local timezone. */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') {
        const result = JSON.stringify(value);
        if (result === undefined || (typeof value === 'number' && !Number.isFinite(value)))
            throw new RangeError('Save contains non-JSON data.');
        return result;
    }
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
}
/** FNV-1a over JS UTF-16 code units. Detects accidental corruption; not authentication. */
export function saveChecksum(payload) {
    const text = canonicalJson(payload);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++)
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
}
function object(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new RangeError(`Invalid ${name}.`);
}
function nonnegative(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        throw new RangeError(`Invalid ${name}.`);
}
function integer(value, name, minimum = 0) {
    nonnegative(value, name);
    if (!Number.isInteger(value) || value < minimum)
        throw new RangeError(`Invalid ${name}.`);
}
function compatible(payload) {
    if (payload.schemaVersion !== 3 || payload.simulationVersion !== SIMULATION_CONFIG.simulationVersion || payload.configVersion !== SIMULATION_CONFIG.version) {
        throw new RangeError('Unsupported save schema, simulation or configuration version; no automatic migration.');
    }
    const world = payload.world, origin = payload.origin;
    object(world, 'world');
    object(origin, 'origin');
    if (typeof world.scenarioId !== 'string' || !world.scenarioId || typeof world.seed !== 'string')
        throw new RangeError('Invalid scenario metadata.');
    integer(world.scenarioVersion, 'scenarioVersion', 1);
    if (payload.scenarioId !== world.scenarioId || payload.scenarioVersion !== world.scenarioVersion || payload.seed !== world.seed ||
        origin.schemaVersion !== 3 || origin.simulationVersion !== payload.simulationVersion || origin.configVersion !== payload.configVersion ||
        origin.scenarioId !== world.scenarioId || origin.scenarioVersion !== world.scenarioVersion || origin.seed !== world.seed)
        throw new RangeError('Scenario, seed or origin version mismatch.');
    validateOrigin(world, origin);
    object(payload.options, 'options');
    if (payload.options.confirmRisk !== undefined && typeof payload.options.confirmRisk !== 'boolean')
        throw new RangeError('Invalid saved risk confirmation.');
    searchLimits(payload.options);
    if (!Array.isArray(payload.actions))
        throw new RangeError('Invalid saved actions.');
    for (const action of payload.actions)
        validateAction(world, action);
}
function validateOrigin(world, state) {
    validateUtcMs(state.startTimeUtc);
    validateUtcMs(state.currentTimeUtc);
    if (state.startTimeUtc > state.currentTimeUtc || state.phase !== 'planning' || state.activeAction !== null || state.death !== null)
        throw new RangeError('Save origin must be a valid planning state.');
    if (!Array.isArray(world.airports) || !world.airports.length || !Array.isArray(state.discovered) || !state.discovered.length)
        throw new RangeError('Missing airports or discoveries.');
    object(state.stocks, 'stocks');
    object(state.aircraft, 'aircraft');
    const ids = new Set();
    for (const airport of world.airports) {
        object(airport, 'airport');
        validateCoordinates({ latitudeDeg: airport.latitudeDeg, longitudeDeg: airport.longitudeDeg });
        if (typeof airport.id !== 'string' || !airport.id || ids.has(airport.id))
            throw new RangeError('Invalid or duplicate airport ID.');
        ids.add(airport.id);
        object(airport.stockBounds, 'stock bounds');
        const stock = state.stocks[airport.id];
        object(stock, 'stock');
        for (const key of ['fuelKg', 'foodPersonHours']) {
            const bounds = airport.stockBounds[key];
            if (!Array.isArray(bounds) || bounds.length !== 2)
                throw new RangeError('Invalid stock bounds.');
            nonnegative(bounds[0], 'lower stock bound');
            nonnegative(bounds[1], 'upper stock bound');
            nonnegative(stock[key], key);
            if (bounds[0] > bounds[1] || stock[key] > bounds[1] || (!state.discovered.includes(airport.id) && stock[key] < bounds[0]))
                throw new RangeError('Stock inconsistent with scenario.');
        }
    }
    if (Object.keys(state.stocks).length !== ids.size || state.discovered.some(id => typeof id !== 'string' || !ids.has(id)) ||
        new Set(state.discovered).size !== state.discovered.length)
        throw new RangeError('Invalid warehouse IDs or discoveries.');
    const aircraft = state.aircraft;
    nonnegative(aircraft.fuelKg, 'aircraft fuel');
    nonnegative(aircraft.foodPersonHours, 'aircraft food');
    if (aircraft.fuelKg > SIMULATION_CONFIG.fuelCapacityKg || aircraft.foodPersonHours > SIMULATION_CONFIG.foodCapacityPersonHours ||
        typeof aircraft.airportId !== 'string' || !state.discovered.includes(aircraft.airportId) || aircraft.activeFlight !== null)
        throw new RangeError('Invalid origin aircraft.');
    object(aircraft.position, 'origin position');
    validateCoordinates(aircraft.position);
    const airport = world.airports.find(a => a.id === aircraft.airportId);
    if (aircraft.position.latitudeDeg !== airport.latitudeDeg || aircraft.position.longitudeDeg !== airport.longitudeDeg)
        throw new RangeError('Origin position differs from airport.');
    if (typeof state.serviceRequired !== 'boolean' || typeof state.departurePrepared !== 'boolean' || (state.serviceRequired && state.departurePrepared))
        throw new RangeError('Invalid service/preparation flags.');
    nonnegative(state.distanceKm, 'distance');
    integer(state.completedFlights, 'completedFlights');
    if (state.completedFlights < state.discovered.length - 1)
        throw new RangeError('Flight count contradicts discoveries.');
    if (!Array.isArray(state.achievements) || new Set(state.achievements).size !== state.achievements.length ||
        state.achievements.some(days => !SIMULATION_CONFIG.achievementsDays.includes(days) || state.startTimeUtc + days * 86400000 > state.currentTimeUtc) ||
        SIMULATION_CONFIG.achievementsDays.some(days => state.startTimeUtc + days * 86400000 <= state.currentTimeUtc && !state.achievements.includes(days)))
        throw new RangeError('Invalid origin achievements.');
    if (state.waitingWarning !== null) {
        object(state.waitingWarning, 'waiting warning');
        validateUtcMs(state.waitingWarning.issuedUtcMs);
        if (state.waitingWarning.issuedUtcMs > state.currentTimeUtc || !Array.isArray(state.waitingWarning.reasons) || !state.waitingWarning.reasons.length ||
            state.waitingWarning.reasons.some(reason => !['food_threshold', 'sunrise_warning'].includes(reason)))
            throw new RangeError('Invalid warning history.');
        nonnegative(state.waitingWarning.foodThresholdCrewHours, 'warning food threshold');
        nonnegative(state.waitingWarning.sunriseWarningHours, 'warning sun threshold');
    }
}
function validateAction(world, action) {
    object(action, 'action');
    if (action.kind === 'load') {
        nonnegative(action.fuelKg, 'load fuel');
        nonnegative(action.foodPersonHours, 'load food');
    }
    else if (action.kind === 'wait')
        nonnegative(action.seconds, 'wait seconds');
    else if (action.kind === 'fly') {
        if (!world.airports.some(a => a.id === action.destinationId))
            throw new RangeError('Unknown saved destination.');
    }
    else if (action.kind === 'auto_wait') {
        if (action.options !== undefined) {
            object(action.options, 'waiting options');
            searchLimits(action.options);
            if (action.options.horizonDays !== undefined && (typeof action.options.horizonDays !== 'number' || !Number.isFinite(action.options.horizonDays) || action.options.horizonDays < 370 || action.options.horizonDays > 10000))
                throw new RangeError('Invalid saved search horizon.');
            if (action.options.foodThresholdCrewHours !== undefined)
                nonnegative(action.options.foodThresholdCrewHours, 'food threshold');
            if (action.options.sunriseWarningHours !== undefined)
                nonnegative(action.options.sunriseWarningHours, 'sun threshold');
        }
    }
    else if (!['prepare', 'service'].includes(action.kind))
        throw new RangeError('Unknown saved action.');
}
export function serializeSession(session) {
    const payload = session.savePayload();
    compatible(payload);
    return canonicalJson({ formatVersion: SAVE_FORMAT_VERSION, payload, checksum: saveChecksum(payload) }) + '\n';
}
/** Build a new session only after all checks. The caller's current session is never changed. */
export function restoreSession(serialized, expectedWorld) {
    let envelope;
    try {
        envelope = JSON.parse(serialized);
    }
    catch {
        throw new RangeError('Save is not valid JSON.');
    }
    object(envelope, 'save envelope');
    if (envelope.formatVersion !== SAVE_FORMAT_VERSION)
        throw new RangeError('Unsupported save format version.');
    object(envelope.payload, 'save payload');
    const payload = envelope.payload;
    if (typeof envelope.checksum !== 'string' || envelope.checksum !== saveChecksum(payload))
        throw new RangeError('Save checksum mismatch.');
    compatible(payload);
    if (expectedWorld && canonicalJson(expectedWorld) !== canonicalJson(payload.world))
        throw new RangeError('Save belongs to a different scenario, seed or airport catalog.');
    validateUtcMs(payload.cursorUtcMs);
    integer(payload.consumedEvents, 'delivery cursor');
    let session;
    try {
        session = new SimulationSession(payload.world, payload.origin, payload.actions, payload.options);
    }
    catch (error) {
        if (error instanceof SessionError)
            throw new RangeError(`Saved plan cannot be restored (${error.outcome}): ${error.message}`);
        throw error;
    }
    session.restoreCursor(payload.cursorUtcMs, payload.consumedEvents);
    const replay = session.savePayload();
    if (canonicalJson(payload.snapshot) !== canonicalJson(replay.snapshot) || canonicalJson(payload.journal) !== canonicalJson(replay.journal))
        throw new RangeError('Saved snapshot or journal differs from deterministic replay.');
    return session;
}
