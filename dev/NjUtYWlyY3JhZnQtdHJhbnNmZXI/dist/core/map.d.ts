import type { Coordinates } from './solar.js';
/** Sample the kernel's orthodromy, then split drawing at the map seam.
 * Projection is for display only; it never participates in safety. */
export declare function mapRoute(from: Coordinates, to: Coordinates): Coordinates[][];
