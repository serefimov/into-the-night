/** All public timestamps are milliseconds since Unix epoch, in UTC.
 * Durations: seconds; distance: km; fuel: kg; food: person-hours.
 * Coordinates and displayed solar altitude: degrees, east-positive longitude.
 */
export declare const SOLAR_MODEL: Readonly<{
    version: "meeus-noaa-1";
    configVersion: 1;
    startUtcMs: number;
    endUtcMsExclusive: number;
    angularValidationLimitDeg: 0.05;
    earthRadiusKm: 6371.0088;
}>;
