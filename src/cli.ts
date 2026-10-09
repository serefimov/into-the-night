import { solarCliOutput } from './cli-command.js';

// Node-only adapter. Keep the computational module independent of Node types.
declare const process: {
  argv: string[];
  stdout: { write(text: string): void };
  stderr: { write(text: string): void };
  exitCode: number;
};

try { process.stdout.write(solarCliOutput(process.argv.slice(2))); }
catch (error) {
  process.stderr.write(JSON.stringify({ error: 'validation_error', message: error instanceof Error ? error.message : String(error) }) + '\n');
  process.exitCode = 1;
}
