import type { GreatCircle } from './geometry.js';
import type { GlobeFrame, GlobePoint } from './globe.js';
export declare function globeFlightPoint(path: GreatCircle, fraction: number, frame: GlobeFrame): GlobePoint;
/** Project d(r(f) n(f))/df, including the radial part during the visual ramps. */
export declare function globeFlightHeading(path: GreatCircle, fraction: number, frame: GlobeFrame): number | null;
export interface GlobeFlightLines {
    front: GlobePoint[][];
    back: GlobePoint[][];
}
/** Curved display trajectory split at the centre plane for painter ordering:
 * draw back lines, then the opaque Earth, then front lines. This preserves the
 * parts of the rear arc outside the limb without leaking through the sphere.
 * Subdivide to 0.2 CSS px chord error (quarter/midpoint probes), at most 2°.
 * Include the current fraction so the plane anchor is exactly a line vertex. */
export declare function globeFlightLines(path: GreatCircle, frame: GlobeFrame, currentFraction?: number): GlobeFlightLines;
