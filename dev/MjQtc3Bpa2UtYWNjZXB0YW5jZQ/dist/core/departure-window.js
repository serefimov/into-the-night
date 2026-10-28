// SPDX-License-Identifier: GPL-3.0-only
import { forecastMissionFlight } from './mission-flight.js';
import { forecastMissionWait } from './mission-wait.js';
import { availabilityReason } from './mission-availability.js';
import { searchLimits } from './interval-search.js';
export const DEPARTURE_SEARCH = Object.freeze({ horizonSeconds: 86400, stepSeconds: 900, defaultMaxEvaluations: searchLimits().maxEvaluations });
/** Chronological finite grid. Yields after each candidate so worker/fallback can
 * cooperate with cancellation and input. It never mutates the mission. */
export function* departureWindowSteps(world, state, toId, immediate, options = {}) {
    const horizonEndUtcMs = state.utcMs + DEPARTURE_SEARCH.horizonSeconds * 1000;
    let checked = 0, evaluations = immediate.forecast?.solar.evaluations ?? 0, earlierUncertain = false;
    const budget = searchLimits(options).maxEvaluations;
    const result = (status, limit = null, startUtcMs = null, forecast = null) => ({ status, limit, startUtcMs, forecast, horizonEndUtcMs, stepSeconds: DEPARTURE_SEARCH.stepSeconds, checked, evaluations, earlierUncertain });
    if (immediate.reasons.includes('simulation_horizon'))
        return result('not_found', 'range');
    if (immediate.allowed)
        return result('now', null, state.utcMs, immediate.forecast);
    if (!immediate.forecast || !['sun', 'unresolved'].includes(availabilityReason(immediate)))
        return result('blocked');
    const origin = world.airports.find(a => a.id === state.airportId);
    for (let time = state.utcMs + DEPARTURE_SEARCH.stepSeconds * 1000; time <= horizonEndUtcMs; time += DEPARTURE_SEARCH.stepSeconds * 1000) {
        if (budget - evaluations < 4)
            return result('indeterminate', 'budget');
        let standing;
        try {
            standing = forecastMissionWait({ position: origin, startUtcMs: state.utcMs, endUtcMs: time }, { ...options, maxEvaluations: budget - evaluations });
        }
        catch (error) {
            if (error instanceof RangeError && error.message.startsWith('UTC must'))
                return result('not_found', 'range');
            throw error;
        }
        evaluations += standing.evaluations;
        if (standing.status === 'unsafe')
            return result(earlierUncertain ? 'indeterminate' : 'not_found', 'sunrise');
        if (standing.status === 'indeterminate')
            return result('indeterminate', standing.reason === 'evaluation_budget' ? 'budget' : 'sunrise');
        if (budget - evaluations < 4)
            return result('indeterminate', 'budget');
        let flight;
        try {
            flight = forecastMissionFlight(world, { ...state, utcMs: time }, toId, { ...options, maxEvaluations: budget - evaluations });
        }
        catch (error) {
            if (error instanceof RangeError && error.message.startsWith('UTC must'))
                return result('not_found', 'range');
            throw error;
        }
        checked++;
        evaluations += flight.solar.evaluations;
        if (flight.allowed)
            return result('waiting', null, time, flight);
        if (flight.solar.status === 'indeterminate')
            earlierUncertain = true;
        yield;
    }
    return result(earlierUncertain ? 'indeterminate' : 'not_found', 'horizon');
}
