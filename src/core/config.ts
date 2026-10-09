/** All public timestamps are milliseconds since Unix epoch, in UTC.
 * Durations: seconds; distance: km; fuel: kg; food: person-hours.
 * Coordinates and displayed solar altitude: degrees, east-positive longitude.
 */
export const SOLAR_MODEL = Object.freeze({
  version: 'meeus-noaa-1',
  configVersion: 1,
  startUtcMs: Date.UTC(2020, 0, 1),
  endUtcMsExclusive: Date.UTC(2041, 0, 1),
  angularValidationLimitDeg: 0.05,
  earthRadiusKm: 6371.0088,
});
