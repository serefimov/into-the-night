import type { World } from './simulation.js';
import { SimulationSession } from './sessions.js';
export declare const SAVE_FORMAT_VERSION = 1;
export { canonicalJson, saveChecksum } from './serialization.js';
export declare function serializeSession(session: SimulationSession): string;
/** Build a new session only after all checks. The caller's current session is never changed. */
export declare function restoreSession(serialized: string, expectedWorld?: World): SimulationSession;
