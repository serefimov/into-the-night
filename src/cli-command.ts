import { SOLAR_MODEL, parseUtc, solarExposure } from './core/index.js';

const usage = 'Usage: npm run solar -- --utc 2026-11-20T03:00:00Z --lat 60.202778 --lon 11.083889';
export function solarCliOutput(args: string[]): string {
  if (args.length === 1 && args[0] === '--help') { return usage + '\n'; }
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; const value = args[i + 1];
    if (!key || !['--utc', '--lat', '--lon'].includes(key) || value === undefined || options.has(key)) {
      throw new RangeError(usage);
    }
    options.set(key, value);
  }
  const utc = options.get('--utc'); const lat = options.get('--lat'); const lon = options.get('--lon');
  if (utc === undefined || lat === undefined || lon === undefined || !lat.trim() || !lon.trim()) {
    throw new RangeError(usage);
  }
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!numeric.test(lat) || !numeric.test(lon)) throw new RangeError('Coordinates must be decimal numbers.');
  const utcMs = parseUtc(utc);
  const position = { latitudeDeg: Number(lat), longitudeDeg: Number(lon) };
  return JSON.stringify({ modelVersion: SOLAR_MODEL.version, configVersion: SOLAR_MODEL.configVersion,
    utc: new Date(utcMs).toISOString(), utcMs, ...position, ...solarExposure(position, utcMs) }, null, 2) + '\n';
}
