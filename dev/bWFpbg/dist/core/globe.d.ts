import type { Coordinates, Vector3 } from './solar.js';
export interface GlobeFrame {
    center: Coordinates;
    cx: number;
    cy: number;
    radius: number;
    east: Vector3;
    north: Vector3;
    forward: Vector3;
}
export interface GlobePoint {
    x: number;
    y: number;
    depth: number;
    visible: boolean;
}
/** Orthographic display only. It does not determine route distance, time or safety. */
export declare function globeFrame(center: Coordinates, width: number, height: number, zoom?: number): GlobeFrame;
/** Radius is relative to Earth. A point behind the centre plane can still be
 * visible above the limb; only the unit Earth sphere occludes it. */
export declare function globePoint(location: Coordinates, frame: GlobeFrame, radius?: number): GlobePoint;
export declare function globeNormal(x: number, y: number, f: GlobeFrame): Vector3 | null;
export declare function globeLocation(x: number, y: number, f: GlobeFrame): Coordinates | null;
/** Clip sampled display lines at the visible hemisphere; there is no longitude seam in this projection. */
export declare function globeLines(points: readonly Coordinates[], f: GlobeFrame): {
    x: number;
    y: number;
}[][];
export declare function globeRoute(from: Coordinates, to: Coordinates): Coordinates[];
