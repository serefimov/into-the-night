export declare function validateUtcMs(utcMs: number): void;
/** Explicit Z only. Reject implicit local time and Date.parse calendar rollover. */
export declare function parseUtc(text: string): number;
