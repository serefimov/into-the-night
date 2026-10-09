import { readFileSync } from 'node:fs';
import { routeCliOutput } from '../dist/route-cli-command.js';
try {
  process.stdout.write(routeCliOutput(process.argv.slice(2), path => readFileSync(path, 'utf8')));
} catch (error) {
  process.stderr.write(JSON.stringify({ error: 'validation_error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
