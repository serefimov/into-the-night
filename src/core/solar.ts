import { validateUtcMs } from './time.js';

export type Vector3 = readonly [number, number, number];
export interface Coordinates { latitudeDeg: number; longitudeDeg: number }
export interface SolarExposure {
  direction: Vector3;
  q: number;
  altitudeDeg: number;
  safe: boolean;
}
const DEG = Math.PI / 180;
const sin = (degrees: number): number => Math.sin(degrees * DEG);
const cos = (degrees: number): number => Math.cos(degrees * DEG);
const normalizeDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;

export function validateCoordinates(position: Coordinates): void {
  if (!position || !Number.isFinite(position.latitudeDeg) || !Number.isFinite(position.longitudeDeg) ||
      Math.abs(position.latitudeDeg) > 90 || Math.abs(position.longitudeDeg) > 180) {
    throw new RangeError('Latitude must be in [-90, 90], longitude in [-180, 180], in finite degrees.');
  }
}

export function surfaceNormal(position: Coordinates): Vector3 {
  validateCoordinates(position);
  // Exact pole avoids an artificial longitude-dependent horizontal component.
  if (Math.abs(position.latitudeDeg) === 90) return [0, 0, Math.sign(position.latitudeDeg)];
  return [cos(position.latitudeDeg) * cos(position.longitudeDeg),
    cos(position.latitudeDeg) * sin(position.longitudeDeg), sin(position.latitudeDeg)];
}

/** Apparent geocentric solar center in Earth-fixed axes:
 * x=(lat 0, lon 0), y=(lat 0, lon 90 E), z=north pole.
 * Meeus/NOAA low-order ephemeris; UTC approximates UT1 and ephemeris time.
 * Nutation applied consistently to apparent longitude and sidereal rotation.
 * No atmospheric refraction, topocentric parallax, disk radius or aircraft height.
 */
export function solarDirection(utcMs: number): Vector3 {
  validateUtcMs(utcMs);
  const jd = utcMs / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const longitude = normalizeDegrees(280.46646 + t * (36000.76983 + 0.0003032 * t));
  const anomaly = normalizeDegrees(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const center = sin(anomaly) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sin(2 * anomaly) * (0.019993 - 0.000101 * t) + sin(3 * anomaly) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const nutationLongitude = -0.00478 * sin(omega);
  const apparentLongitude = longitude + center - 0.00569 + nutationLongitude;
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - 0.001813 * t))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const rightAscension = Math.atan2(cos(obliquity) * sin(apparentLongitude), cos(apparentLongitude));
  const declination = Math.asin(sin(obliquity) * sin(apparentLongitude));
  const gmst = normalizeDegrees(280.46061837 + 360.98564736629 * (jd - 2451545) +
    0.000387933 * t * t - t * t * t / 38710000);
  const gast = gmst + nutationLongitude * cos(obliquity);
  const earthLongitude = rightAscension - gast * DEG;
  return [Math.cos(declination) * Math.cos(earthLongitude),
    Math.cos(declination) * Math.sin(earthLongitude), Math.sin(declination)];
}

/** No epsilon safety band: the model's exact boundary is q >= 0. */
export function isSolarSafe(q: number): boolean {
  if (!Number.isFinite(q) || q < -1 || q > 1) throw new RangeError('q must be finite and in [-1, 1].');
  return q < 0;
}

export function solarExposure(position: Coordinates, utcMs: number): SolarExposure {
  const normal = surfaceNormal(position);
  const direction = solarDirection(utcMs);
  const dot = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  const q = Math.max(-1, Math.min(1, dot));
  return { direction, q, altitudeDeg: Math.asin(q) / DEG, safe: isSolarSafe(q) };
}
