import { SOLAR_MODEL } from './config.js';
import { surfaceNormal } from './solar.js';
import type { Coordinates, Vector3 } from './solar.js';

export interface GreatCircle {
  readonly from: Readonly<Coordinates>;
  readonly to: Readonly<Coordinates>;
  readonly start: Vector3;
  readonly tangent: Vector3;
  readonly angleRad: number;
  readonly distanceKm: number;
}
const dot = (a: Vector3, b: Vector3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** atan2(cross,dot) is the stable equivalent of acos(clamp(dot)).
 * Coincidence: <=1e-10 rad; ambiguity: within 1e-6 rad of antipodal.
 * Reject rather than invent a great-circle plane for ambiguous antipodes.
 */
export function greatCircle(from: Coordinates, to: Coordinates): GreatCircle {
  const start = surfaceNormal(from), end = surfaceNormal(to);
  const axis = cross(start, end);
  const sine = Math.hypot(...axis);
  const angleRad = Math.atan2(sine, Math.max(-1, Math.min(1, dot(start, end))));
  if (angleRad <= 1e-10) throw new RangeError('Coincident points do not define a flight.');
  if (Math.PI - angleRad <= 1e-6) throw new RangeError('Near-antipodal route is ambiguous.');
  const unitAxis: Vector3 = [axis[0] / sine, axis[1] / sine, axis[2] / sine];
  const tangent = cross(unitAxis, start);
  return Object.freeze({ from: Object.freeze({ latitudeDeg: from.latitudeDeg, longitudeDeg: from.longitudeDeg }),
    to: Object.freeze({ latitudeDeg: to.latitudeDeg, longitudeDeg: to.longitudeDeg }),
    start: Object.freeze(start), tangent: Object.freeze(tangent), angleRad,
    distanceKm: SOLAR_MODEL.earthRadiusKm * angleRad });
}

export function greatCircleNormal(path: GreatCircle, fraction: number): Vector3 {
  if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new RangeError('Route fraction must be finite and in [0, 1].');
  }
  if (fraction === 0) return path.start;
  if (fraction === 1) return surfaceNormal(path.to);
  const angle = path.angleRad * fraction;
  const c = Math.cos(angle), s = Math.sin(angle);
  const vector: Vector3 = [path.start[0] * c + path.tangent[0] * s,
    path.start[1] * c + path.tangent[1] * s, path.start[2] * c + path.tangent[2] * s];
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function normalCoordinates(normal: Vector3): Coordinates {
  const horizontal = Math.hypot(normal[0], normal[1]);
  return { latitudeDeg: Math.atan2(normal[2], horizontal) * 180 / Math.PI,
    longitudeDeg: horizontal < 1e-14 ? 0 : Math.atan2(normal[1], normal[0]) * 180 / Math.PI };
}

export function greatCirclePosition(path: GreatCircle, fraction: number): Coordinates {
  if (fraction === 0) return { ...path.from };
  if (fraction === 1) return { ...path.to };
  return normalCoordinates(greatCircleNormal(path, fraction));
}
