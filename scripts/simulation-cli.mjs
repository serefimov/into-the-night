import { readFileSync } from 'node:fs';
import { createSimulation, forecastPlan, executePlan, visibleState } from '../dist/core/simulation.js';
import { parseUtc } from '../dist/core/time.js';
try {
  const args = process.argv.slice(2);
  let file, mode = 'forecast', confirmRisk = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--confirm-risk') { confirmRisk = true; continue; }
    if (args[i] === '--plan' && args[i + 1]) { file = args[++i]; continue; }
    if (args[i] === '--mode' && args[i + 1]) { mode = args[++i]; continue; }
    throw new Error('Usage: --plan FILE [--mode forecast|execute] [--confirm-risk]');
  }
  if (!file || !['forecast', 'execute'].includes(mode) || (confirmRisk && mode !== 'execute')) throw new Error('Invalid CLI arguments.');
  const input = JSON.parse(readFileSync(file, 'utf8'));
  const state = createSimulation(input.world, input.stocks, parseUtc(input.utc), input.airportId, input.aircraft, input.serviced ?? true);
  const result = mode === 'forecast' ? forecastPlan(input.world, state, input.actions) : executePlan(input.world, state, input.actions, { confirmRisk });
  if (mode === 'execute') result.state = visibleState(input.world, result.state);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.outcome === 'validation_error') process.exitCode = 2;
} catch (error) { process.stderr.write(JSON.stringify({ error: 'validation_error', message: error.message }) + '\n'); process.exitCode = 2; }
