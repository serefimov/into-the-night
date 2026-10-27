// SPDX-License-Identifier: GPL-3.0-only
import { surfaceNormal } from './solar.js';
import { normalCoordinates, greatCircle, greatCirclePosition } from './geometry.js';
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Orthographic display only. It does not determine route distance, time or safety. */
export function globeFrame(center, width, height, zoom = 1) {
    const forward = surfaceNormal(center);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(zoom) || zoom <= 0)
        throw new RangeError('Invalid globe viewport');
    const lat = center.latitudeDeg * Math.PI / 180, lon = center.longitudeDeg * Math.PI / 180;
    return { center: { ...center }, cx: width / 2, cy: height / 2, radius: Math.min(width, height) * .44 * zoom, forward,
        east: [-Math.sin(lon), Math.cos(lon), 0], north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)] };
}
export function globePoint(location, frame) {
    const n = surfaceNormal(location), depth = dot(n, frame.forward);
    return { x: frame.cx + frame.radius * dot(n, frame.east), y: frame.cy - frame.radius * dot(n, frame.north), depth, visible: depth >= 0 };
}
/** Clockwise radians from screen-up, using the accepted path's tangent at the
 * actual position. No target projection, longitude difference or time step.
 * A nearly radial tangent has no stable screen heading (null). */
export function globeRouteHeading(path, location, frame) {
    const n = surfaceNormal(location), c = dot(n, path.start), s = dot(n, path.tangent);
    const tangent = [path.tangent[0] * c - path.start[0] * s, path.tangent[1] * c - path.start[1] * s, path.tangent[2] * c - path.start[2] * s];
    const right = dot(tangent, frame.east), up = dot(tangent, frame.north);
    return Math.hypot(right, up) < 1e-6 ? null : Math.atan2(right, up);
}
export function globeNormal(x, y, f) {
    const east = (x - f.cx) / f.radius, north = (f.cy - y) / f.radius, r2 = east * east + north * north;
    if (r2 > 1)
        return null;
    const front = Math.sqrt(Math.max(0, 1 - r2));
    return [east * f.east[0] + north * f.north[0] + front * f.forward[0], east * f.east[1] + north * f.north[1] + front * f.forward[1], east * f.east[2] + north * f.north[2] + front * f.forward[2]];
}
export function globeLocation(x, y, f) { const n = globeNormal(x, y, f); return n ? normalCoordinates(n) : null; }
/** Clip sampled display lines at the visible hemisphere; there is no longitude seam in this projection. */
export function globeLines(points, f) {
    const lines = [];
    let line = [], previous = null;
    for (const location of points) {
        const point = globePoint(location, f);
        if (previous && previous.visible !== point.visible) {
            const t = previous.depth / (previous.depth - point.depth), x = previous.x + (point.x - previous.x) * t - f.cx, y = previous.y + (point.y - previous.y) * t - f.cy, length = Math.hypot(x, y);
            if (length < 1e-12) {
                if (line.length > 1)
                    lines.push(line);
                line = [];
                previous = point;
                if (point.visible)
                    line.push(point);
                continue;
            }
            const limb = { x: f.cx + x * f.radius / length, y: f.cy + y * f.radius / length };
            if (previous.visible) {
                line.push(limb);
                if (line.length > 1)
                    lines.push(line);
                line = [];
            }
            else
                line = [limb];
        }
        if (point.visible)
            line.push({ x: point.x, y: point.y });
        previous = point;
    }
    if (line.length > 1)
        lines.push(line);
    return lines;
}
export function globeRoute(from, to) {
    const path = greatCircle(from, to), count = Math.max(8, Math.ceil(path.angleRad * 180 / Math.PI));
    return Array.from({ length: count + 1 }, (_, i) => greatCirclePosition(path, i / count));
}
