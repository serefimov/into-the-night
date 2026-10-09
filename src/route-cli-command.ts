import { checkRouteSafety, createRoutePlan, executeSolarRoute, parseUtc } from './core/index.js';
import type { Coordinates, RouteRequest, SearchOptions } from './core/index.js';
const usage = 'Usage: npm run route -- --utc 2026-11-20T03:00:00Z --plan examples/oslo-tromso.json [--mode forecast|execute] [--event-tolerance 0.5] [--max-interval 900] [--max-evaluations 100000]';
export function routeCliOutput(args: string[], readPlan: (path: string) => string): string {
  if (args.length === 1 && args[0] === '--help') return usage + '\n';
  const options = new Map<string, string>();
  const allowed = ['--utc', '--plan', '--mode', '--event-tolerance', '--max-interval', '--max-evaluations'];
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key || !allowed.includes(key) || value === undefined || !value.trim() || options.has(key)) {
      throw new RangeError(usage);
    }
    options.set(key, value);
  }
  const utc = options.get('--utc'), path = options.get('--plan');
  const mode = options.get('--mode') ?? 'forecast';
  if (!utc || !path || !['forecast', 'execute'].includes(mode)) throw new RangeError(usage);
  const input: unknown = JSON.parse(readPlan(path));
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['waypoints', 'initialServiceRequired'].includes(key))) {
    throw new RangeError('Plan accepts only waypoints and initialServiceRequired.');
  }
  const data = input as { waypoints: Coordinates[]; initialServiceRequired?: boolean };
  const request: RouteRequest = { ...data, startUtcMs: parseUtc(utc) };
  const search: { -readonly [K in keyof SearchOptions]: SearchOptions[K] } = {};
  for (const [flag, key] of [['--event-tolerance', 'eventToleranceSeconds'],
    ['--max-interval', 'maxIntervalSeconds'], ['--max-evaluations', 'maxEvaluations']] as const) {
    const value = options.get(flag);
    if (value !== undefined) {
      if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) throw new RangeError('Search settings must be decimal numbers.');
      search[key] = Number(value);
    }
  }
  const plan = createRoutePlan(request);
  const outcome = mode === 'execute' ? executeSolarRoute(request, search) : checkRouteSafety(request, search);
  return JSON.stringify({ mode, ...outcome, startUtc: new Date(plan.startUtcMs).toISOString(),
    endUtc: new Date(plan.endUtcMs).toISOString(),
    phases: plan.phases.map(({ kind, legIndex, startUtcMs, endUtcMs }) => ({ kind, legIndex, startUtcMs, endUtcMs })) }, null, 2) + '\n';
}
