import { generateScenario } from './scenario.js';
import { createSimulation, forecastPlan, visibleState } from './simulation.js';
import { SimulationSession, ForecastTimeline, copy } from './sessions.js';
import { serializeSession, restoreSession, canonicalJson, saveChecksum } from './saves.js';
import { SOLAR_MODEL } from './config.js';
import { ROUTE_MODEL } from './route.js';
import { parseUtc } from './time.js';
import { forecastStanding, searchStationarySunrise } from './waiting.js';
import { solarExposure } from './solar.js';
import { greatCircle } from './geometry.js';
import { createRoutePlan } from './route.js';
/** Browser/CLI game adapter. Only public projections leave normal gameplay methods.
 * Private state crosses the boundary solely in explicitly exported saves. */
export class SpikeGame {
    #world;
    #state;
    #session = null;
    #records = [];
    constructor(catalog, scenario) {
        const { world, stocks } = generateScenario(catalog, scenario);
        this.#world = world;
        this.#state = createSimulation(world, stocks, parseUtc(scenario.utc), scenario.airportId, scenario.aircraft, scenario.serviced);
        this.#initial = copy(this.#state);
    }
    get active() { return this.#session !== null; }
    get endUtcMs() { return this.#session?.endUtcMs ?? this.#state.currentTimeUtc; }
    current() { return this.#session?.current().state ?? visibleState(this.#world, this.#state); }
    forecast(actions) {
        this.#planning();
        return forecastPlan(this.#world, this.#state, actions);
    }
    preview(actions, utcMs) {
        this.#planning();
        return new ForecastTimeline(this.#world, this.#state, actions).stateAt(utcMs);
    }
    flight(destinationId) {
        this.#planning();
        const from = this.#world.airports.find(a => a.id === this.#state.aircraft.airportId);
        const to = this.#world.airports.find(a => a.id === destinationId);
        if (!to)
            throw new RangeError('Unknown destination.');
        const actions = [];
        if (this.#state.serviceRequired)
            actions.push({ kind: 'service' });
        if (!this.#state.departurePrepared)
            actions.push({ kind: 'prepare' });
        actions.push({ kind: 'fly', destinationId });
        const forecast = this.forecast(actions);
        const distanceKm = greatCircle(from, to).distanceKm;
        const route = createRoutePlan({ startUtcMs: this.#state.currentTimeUtc, waypoints: [from, to], initialServiceRequired: this.#state.serviceRequired });
        const arrivalUtcMs = route.endUtcMs - 900000 - (this.#state.departurePrepared ? 900000 : 0);
        return { actions, forecast, distanceKm, arrivalUtcMs, durationSeconds: (arrivalUtcMs - this.#state.currentTimeUtc) / 1000,
            arrivalSolar: solarExposure(to, arrivalUtcMs), sunrise: searchStationarySunrise(to, arrivalUtcMs) };
    }
    standing() {
        this.#planning();
        const id = this.#state.aircraft.airportId;
        return forecastStanding({ position: this.#state.aircraft.position, startUtcMs: this.#state.currentTimeUtc,
            foodPersonHours: this.#state.stocks[id].foodPersonHours + this.#state.aircraft.foodPersonHours, crew: 30 });
    }
    start(actions, confirmRisk = false) {
        this.#planning();
        if (!actions.length)
            throw new RangeError('Empty plan.');
        this.#session = new SimulationSession(this.#world, this.#state, actions, { confirmRisk });
        if (this.#session.endUtcMs === this.#state.currentTimeUtc)
            this.advance(this.#state.currentTimeUtc);
    }
    advance(utcMs) {
        if (!this.#session)
            throw new RangeError('No active action.');
        const result = this.#session.stopAt(utcMs);
        if (this.#session.currentTimeUtc === this.#session.endUtcMs) {
            this.#state = this.#session.savePayload().snapshot;
            this.#records.push({ session: serializeSession(this.#session), cancelGround: false });
            this.#session = null;
        }
        return result;
    }
    /** End an unfinished ground action at the already committed cursor. Flags are
     * left as calculated: interrupted preparation/service is not completed. */
    cancelGround() {
        if (!this.#session)
            throw new RangeError('No active action.');
        const state = this.#session.savePayload().snapshot;
        this.#state = cancelledGround(state);
        this.#records.push({ session: serializeSession(this.#session), cancelGround: true });
        this.#session = null;
    }
    save() {
        const payload = { metadata: this.#metadata(), records: copy(this.#records), active: this.#session ? serializeSession(this.#session) : null };
        return canonicalJson({ spikeSaveVersion: 1, payload, checksum: saveChecksum(payload) });
    }
    restore(text) {
        const save = JSON.parse(text);
        if (save.spikeSaveVersion !== 1 || !save.payload || !Array.isArray(save.payload.records) ||
            saveChecksum(save.payload) !== save.checksum || canonicalJson(save.payload.metadata) !== canonicalJson(this.#metadata()))
            throw new RangeError('Invalid spike save/checksum.');
        // Validate the entire replay before changing the live game.
        let state = copy(this.#initial);
        const records = [];
        for (const entry of save.payload.records) {
            if (typeof entry.cancelGround !== 'boolean')
                throw new RangeError('Invalid action history.');
            const session = restoreSession(entry.session, this.#world), p = session.savePayload();
            if (canonicalJson(p.origin) !== canonicalJson(state))
                throw new RangeError('Noncontiguous action history.');
            if (!entry.cancelGround && session.currentTimeUtc !== session.endUtcMs)
                throw new RangeError('Incomplete history entry.');
            state = entry.cancelGround ? cancelledGround(p.snapshot) : p.snapshot;
            records.push(copy(entry));
        }
        let active = null;
        if (save.payload.active !== null) {
            active = restoreSession(save.payload.active, this.#world);
            if (canonicalJson(active.savePayload().origin) !== canonicalJson(state) || active.currentTimeUtc >= active.endUtcMs)
                throw new RangeError('Invalid active session.');
        }
        this.#state = state;
        this.#records = records;
        this.#session = active;
    }
    #initial;
    journal() {
        const entries = [...this.#records, ...(this.#session ? [{ session: serializeSession(this.#session), cancelGround: false }] : [])];
        return { journalVersion: 1, scenarioId: this.#world.scenarioId, scenarioVersion: this.#world.scenarioVersion, seed: this.#world.seed,
            simulationVersion: this.#state.simulationVersion, configVersion: this.#state.configVersion, solarModelVersion: SOLAR_MODEL.version, routeModelVersion: ROUTE_MODEL.version,
            entries: entries.map((entry, index) => {
                const p = restoreSession(entry.session, this.#world).savePayload();
                return { actions: p.actions, confirmRisk: p.options.confirmRisk === true, startUtcMs: p.origin.currentTimeUtc,
                    stopUtcMs: p.cursorUtcMs, cancelGround: entry.cancelGround, active: !!this.#session && index === entries.length - 1, events: p.journal };
            }), state: this.current() };
    }
    #metadata() {
        return { scenarioId: this.#world.scenarioId, scenarioVersion: this.#world.scenarioVersion, seed: this.#world.seed, simulationVersion: this.#initial.simulationVersion, configVersion: this.#initial.configVersion, solarModelVersion: SOLAR_MODEL.version, routeModelVersion: ROUTE_MODEL.version };
    }
    #planning() {
        if (this.active || this.#state.phase !== 'planning')
            throw new RangeError('Finish or stop the current action before planning.');
    }
}
function cancelledGround(state) {
    if (state.phase === 'game_over' || state.aircraft.airportId === null || state.aircraft.activeFlight !== null)
        throw new RangeError('Cannot cancel a flight or death.');
    const result = copy(state);
    result.phase = 'planning';
    result.activeAction = null;
    return result;
}
