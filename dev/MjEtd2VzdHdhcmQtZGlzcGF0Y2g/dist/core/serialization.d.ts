/** Stable JSON key order, independent of object insertion order and local timezone. */
export declare function canonicalJson(value: unknown): string;
/** FNV-1a over JS UTF-16 code units. Detects accidental corruption; not authentication. */
export declare function saveChecksum(payload: unknown): string;
