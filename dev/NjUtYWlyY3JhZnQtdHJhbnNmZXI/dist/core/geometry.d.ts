import type { Coordinates, Vector3 } from './solar.js';
export interface GreatCircle {
    readonly from: Readonly<Coordinates>;
    readonly to: Readonly<Coordinates>;
    readonly start: Vector3;
    readonly tangent: Vector3;
    readonly angleRad: number;
    readonly distanceKm: number;
}
/** atan2(cross,dot) is the stable equivalent of acos(clamp(dot)).
 * Coincidence: <=1e-10 rad; ambiguity: within 1e-6 rad of antipodal.
 * Reject rather than invent a great-circle plane for ambiguous antipodes.
 */
export declare function greatCircle(from: Coordinates, to: Coordinates): GreatCircle;
export declare function greatCircleNormal(path: GreatCircle, fraction: number): Vector3;
export declare function normalCoordinates(normal: Vector3): Coordinates;
export declare function greatCirclePosition(path: GreatCircle, fraction: number): Coordinates;
