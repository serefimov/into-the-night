import { SOLAR_MODEL } from './config.js';
import { checkRoutePhaseSafety } from './route.js';
import type { RoutePhase } from './route.js';
import { searchLimits } from './interval-search.js';
import type { SearchOptions, SearchResult } from './interval-search.js';
import { validateCoordinates } from './solar.js';
import type { Coordinates } from './solar.js';
import { validateUtcMs } from './time.js';

export const WAITING_CONFIG = Object.freeze({ version: 1, horizonDays: 370, segmentDays: 30,
  foodThresholdCrewHours: 72, sunriseWarningHours: 12 });
export interface WaitingOptions extends SearchOptions {
  readonly horizonDays?: number;
  readonly foodThresholdCrewHours?: number;
  readonly sunriseWarningHours?: number;
}
export interface SunriseSearch {
  readonly status: 'found' | 'not_found_within_horizon' | 'indeterminate';
  readonly startUtcMs: number;
  readonly requestedEndUtcMs: number;
  readonly searchedUntilUtcMs: number;
  readonly safeUntilUtcMs: number;
  readonly horizonEndUtcMs: number;
  readonly rangeLimited: boolean;
  readonly eventUtcMs: number | null;
  readonly bracketUtcMs: readonly [number, number] | null;
  readonly timeErrorBoundSeconds: number | null;
  readonly evaluations: number;
  readonly segments: number;
  readonly reason: SearchResult['reason'];
}
export interface StandingRequest {
  readonly position: Coordinates;
  readonly startUtcMs: number;
  readonly foodPersonHours: number;
  readonly crew: number;
}
export interface StandingForecast {
  readonly configVersion: number;
  readonly sunrise: SunriseSearch;
  readonly hungerUtcMs: number;
  readonly maximum: {
    readonly status: 'limited' | 'horizon_limited' | 'needs_refinement';
    readonly reason: 'food' | 'sun' | 'search_horizon' | 'uncertainty';
    /** Terminal boundary: survival at this timestamp is NOT promised. */
    readonly boundaryUtcMs: number;
    readonly seconds: number;
    readonly certifiedUntilUtcMs: number;
    readonly eventBracketUtcMs: readonly [number, number] | null;
  };
  readonly automatic: {
    readonly status: 'threshold' | 'search_horizon' | 'needs_refinement';
    readonly stopUtcMs: number;
    readonly seconds: number;
    readonly maximumRemainingSeconds: number | null;
    readonly reasons: readonly ('food_threshold' | 'sunrise_warning' | 'search_horizon' | 'uncertainty')[];
    readonly alreadyReached: boolean;
    readonly foodThresholdCrewHours: number;
    readonly sunriseWarningHours: number;
  };
}
function positiveFinite(value: number, name: string, allowZero = false): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new RangeError(`Invalid ${name}.`);
}
function groundPhase(position: Coordinates, startUtcMs: number, endUtcMs: number): RoutePhase {
  return { kind: 'service', legIndex: 0, startUtcMs, endUtcMs, location: position, path: null };
}
/** Same conservative solar search as flight and execution, in sequential month-sized segments. */
export function searchStationarySunrise(position: Coordinates, startUtcMs: number, options: WaitingOptions = {}): SunriseSearch {
  validateCoordinates(position); validateUtcMs(startUtcMs);
  const horizonDays = options.horizonDays ?? WAITING_CONFIG.horizonDays;
  positiveFinite(horizonDays, 'horizonDays');
  if (horizonDays < WAITING_CONFIG.horizonDays || horizonDays > 10000) throw new RangeError('Sunrise horizon must be 370..10000 days.');
  const limits = searchLimits(options);
  const requestedEndUtcMs = startUtcMs + horizonDays * 86400000;
  // Largest representable supported UTC (timestamps are doubles, not integer milliseconds).
  const horizonEndUtcMs = Math.min(requestedEndUtcMs, SOLAR_MODEL.endUtcMsExclusive - 2 ** (Math.floor(Math.log2(SOLAR_MODEL.endUtcMsExclusive)) - 52));
  const rangeLimited = horizonEndUtcMs < requestedEndUtcMs;
  let cursor = startUtcMs, evaluations = 0, segments = 0;
  do {
    const end = Math.min(horizonEndUtcMs, cursor + WAITING_CONFIG.segmentDays * 86400000);
    const budget = limits.maxEvaluations - evaluations;
    if (budget < 4) return output('indeterminate', cursor, cursor, null, [cursor, end], 'evaluation_budget');
    const result = checkRoutePhaseSafety(groundPhase(position, cursor, end), { ...options, maxEvaluations: budget });
    evaluations += result.evaluations; segments++;
    if (result.status === 'unsafe') return output('found', result.witnessUtcMs!, result.safeUntilUtcMs, result.witnessUtcMs, result.bracket, null);
    if (result.status === 'indeterminate') return output('indeterminate', result.bracket![1], result.safeUntilUtcMs, null, result.bracket, result.reason);
    cursor = end;
  } while (cursor < horizonEndUtcMs);
  return output('not_found_within_horizon', horizonEndUtcMs, horizonEndUtcMs, null, null, null);
  function output(status: SunriseSearch['status'], searchedUntilUtcMs: number, safeUntilUtcMs: number,
    eventUtcMs: number | null, bracketUtcMs: SunriseSearch['bracketUtcMs'], reason: SunriseSearch['reason']): SunriseSearch {
    return { status, startUtcMs, requestedEndUtcMs, searchedUntilUtcMs, safeUntilUtcMs,
      horizonEndUtcMs, rangeLimited, eventUtcMs, bracketUtcMs,
      timeErrorBoundSeconds: status === 'found' ? (bracketUtcMs![1] - bracketUtcMs![0]) / 1000 : null,
      evaluations, segments, reason };
  }
}
export function forecastStanding(request: StandingRequest, options: WaitingOptions = {}): StandingForecast {
  positiveFinite(request.foodPersonHours, 'foodPersonHours', true); positiveFinite(request.crew, 'crew');
  const foodThresholdCrewHours = options.foodThresholdCrewHours ?? WAITING_CONFIG.foodThresholdCrewHours;
  const sunriseWarningHours = options.sunriseWarningHours ?? WAITING_CONFIG.sunriseWarningHours;
  positiveFinite(foodThresholdCrewHours, 'foodThresholdCrewHours', true);
  positiveFinite(sunriseWarningHours, 'sunriseWarningHours', true);
  const consumption = request.crew / 3600;
  const hungerSeconds = request.foodPersonHours / consumption;
  const hungerUtcMs = request.startUtcMs + hungerSeconds * 1000;
  if (!Number.isFinite(hungerUtcMs)) throw new RangeError('Food duration exceeds numeric range.');
  const sunrise = searchStationarySunrise(request.position, request.startUtcMs, options);
  let maximum: StandingForecast['maximum'];
  if (sunrise.status === 'found' && hungerUtcMs >= sunrise.eventUtcMs!) {
    maximum = limit('sun', sunrise.eventUtcMs!, sunrise.safeUntilUtcMs, sunrise.bracketUtcMs);
  } else if (hungerUtcMs <= sunrise.safeUntilUtcMs) maximum = limit('food', hungerUtcMs, hungerUtcMs, [hungerUtcMs, hungerUtcMs]);
  else if (hungerUtcMs <= sunrise.horizonEndUtcMs && sunrise.status === 'found') {
    // Hunger lies inside the solar bracket: search ONLY up to hunger to preserve event order.
    const prefix = checkRoutePhaseSafety(groundPhase(request.position, request.startUtcMs, hungerUtcMs), options);
    if (prefix.status === 'safe') maximum = limit('food', hungerUtcMs, hungerUtcMs, [hungerUtcMs, hungerUtcMs]);
    else if (prefix.status === 'unsafe') maximum = limit('sun', prefix.witnessUtcMs!, prefix.safeUntilUtcMs, prefix.bracket);
    else maximum = uncertain(prefix.safeUntilUtcMs, prefix.bracket);
  } else if (sunrise.status === 'indeterminate') maximum = uncertain(sunrise.safeUntilUtcMs, sunrise.bracketUtcMs);
  else maximum = { status: 'horizon_limited', reason: 'search_horizon', boundaryUtcMs: sunrise.horizonEndUtcMs,
    seconds: (sunrise.horizonEndUtcMs - request.startUtcMs) / 1000, certifiedUntilUtcMs: sunrise.safeUntilUtcMs, eventBracketUtcMs: null };

  const foodSeconds = Math.max(0, (request.foodPersonHours / request.crew - foodThresholdCrewHours) * 3600);
  const foodStop = request.startUtcMs + foodSeconds * 1000;
  // Warn against the EARLIEST possible solar event, not its late positive witness.
  const sunStop = sunrise.status === 'found' ? Math.max(request.startUtcMs, sunrise.bracketUtcMs![0] - sunriseWarningHours * 3600000) : Infinity;
  const horizonStop = sunrise.status === 'not_found_within_horizon' ? Math.max(request.startUtcMs, sunrise.horizonEndUtcMs - sunriseWarningHours * 3600000) : Infinity;
  const candidate = Math.min(foodStop, sunStop, horizonStop);
  let automatic: StandingForecast['automatic'];
  if (candidate <= sunrise.safeUntilUtcMs) {
    const reasons: ('food_threshold' | 'sunrise_warning')[] = [];
    if (foodStop === candidate) reasons.push('food_threshold');
    if (sunStop === candidate) reasons.push('sunrise_warning');
    automatic = horizonStop === candidate && reasons.length === 0 ? auto('search_horizon', candidate, ['search_horizon']) : auto('threshold', candidate, reasons);
  } else if (sunrise.status === 'indeterminate') automatic = auto('needs_refinement', sunrise.safeUntilUtcMs, ['uncertainty']);
  else {
    // No event in the supported horizon: don't pass a warning that could lie just beyond it.
    const stop = Math.max(request.startUtcMs, sunrise.horizonEndUtcMs - sunriseWarningHours * 3600000);
    automatic = auto('search_horizon', stop, ['search_horizon']);
  }
  return { configVersion: WAITING_CONFIG.version, sunrise, hungerUtcMs, maximum, automatic };
  function limit(reason: 'food' | 'sun', time: number, safe: number, bracket: StandingForecast['maximum']['eventBracketUtcMs']): StandingForecast['maximum'] {
    return { status: 'limited', reason, boundaryUtcMs: time, seconds: reason === 'food' ? hungerSeconds : (time - request.startUtcMs) / 1000,
      certifiedUntilUtcMs: safe, eventBracketUtcMs: bracket };
  }
  function uncertain(time: number, bracket: StandingForecast['maximum']['eventBracketUtcMs']): StandingForecast['maximum'] {
    return { status: 'needs_refinement', reason: 'uncertainty', boundaryUtcMs: time,
      seconds: (time - request.startUtcMs) / 1000, certifiedUntilUtcMs: time, eventBracketUtcMs: bracket };
  }
  function auto(status: StandingForecast['automatic']['status'], time: number, reasons: StandingForecast['automatic']['reasons']): StandingForecast['automatic'] {
    return { status, stopUtcMs: time, seconds: time === foodStop ? foodSeconds : (time - request.startUtcMs) / 1000,
      maximumRemainingSeconds: maximum.status === 'limited' ? Math.max(0, (maximum.boundaryUtcMs - time) / 1000) : null,
      reasons, alreadyReached: time === request.startUtcMs, foodThresholdCrewHours, sunriseWarningHours };
  }
}
