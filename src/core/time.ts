import { SOLAR_MODEL } from './config.js';

export function validateUtcMs(utcMs: number): void {
  if (!Number.isFinite(utcMs) || utcMs < SOLAR_MODEL.startUtcMs ||
      utcMs >= SOLAR_MODEL.endUtcMsExclusive) {
    throw new RangeError('UTC must be a finite Unix timestamp (milliseconds) in [2020-01-01, 2041-01-01).');
  }
}

/** Explicit Z only. Reject implicit local time and Date.parse calendar rollover. */
export function parseUtc(text: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) {
    throw new RangeError('Expected UTC YYYY-MM-DDTHH:mm:ss[.sss]Z.');
  }
  const utcMs = Date.parse(text);
  validateUtcMs(utcMs);
  const canonical = text.includes('.') ? text : text.replace('Z', '.000Z');
  if (new Date(utcMs).toISOString() !== canonical) {
    throw new RangeError('Invalid UTC calendar date.');
  }
  return utcMs;
}
