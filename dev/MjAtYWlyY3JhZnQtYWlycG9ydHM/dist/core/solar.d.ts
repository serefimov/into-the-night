export type Vector3 = readonly [number, number, number];
export interface Coordinates {
    latitudeDeg: number;
    longitudeDeg: number;
}
export interface SolarExposure {
    direction: Vector3;
    q: number;
    altitudeDeg: number;
    safe: boolean;
}
export declare function validateCoordinates(position: Coordinates): void;
export declare function surfaceNormal(position: Coordinates): Vector3;
/** Apparent geocentric solar center in Earth-fixed axes:
 * x=(lat 0, lon 0), y=(lat 0, lon 90 E), z=north pole.
 * Meeus/NOAA low-order ephemeris; UTC approximates UT1 and ephemeris time.
 * Nutation applied consistently to apparent longitude and sidereal rotation.
 * No atmospheric refraction, topocentric parallax, disk radius or aircraft height.
 */
export declare function solarDirection(utcMs: number): Vector3;
/** No epsilon safety band: the model's exact boundary is q >= 0. */
export declare function isSolarSafe(q: number): boolean;
export declare function solarExposure(position: Coordinates, utcMs: number): SolarExposure;
