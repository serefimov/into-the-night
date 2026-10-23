import type { World } from './simulation.js';
import { SimulationSession } from './sessions.js';
export declare const SAVE_FORMAT_VERSION = 1;
/** Stable JSON key order, independent of object insertion order and local timezone. */
export declare function canonicalJson(value: unknown): string;
/** FNV-1a over JS UTF-16 code units. Detects accidental corruption; not authentication. */
export declare function saveChecksum(payload: unknown): string;
export declare function serializeSession(session: SimulationSession): string;
/** Build a new session only after all checks. The caller's current session is never changed. */
export declare function restoreSession(serialized: string, expectedWorld?: World): SimulationSession;
