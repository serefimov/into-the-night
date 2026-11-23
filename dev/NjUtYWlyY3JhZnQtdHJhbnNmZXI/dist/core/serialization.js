// SPDX-License-Identifier: GPL-3.0-only
/** Stable JSON key order, independent of object insertion order and local timezone. */
export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') {
        const result = JSON.stringify(value);
        if (result === undefined || (typeof value === 'number' && !Number.isFinite(value)))
            throw new RangeError('Save contains non-JSON data.');
        return result;
    }
    if (Array.isArray(value))
        return '[' + value.map(canonicalJson).join(',') + ']';
    return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') + '}';
}
/** FNV-1a over JS UTF-16 code units. Detects accidental corruption; not authentication. */
export function saveChecksum(payload) {
    const text = canonicalJson(payload);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++)
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
}
