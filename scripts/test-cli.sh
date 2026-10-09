#!/bin/sh
# Process-level check: explicit UTC must produce identical bytes across timezones.
set -eu
solar_cli_test_dir=$(mktemp -d)
trap 'rm -rf "$solar_cli_test_dir"' EXIT HUP INT TERM
for solar_cli_test_tz in UTC Europe/Oslo America/New_York Pacific/Auckland; do
  TZ="$solar_cli_test_tz" node dist/cli.js --utc 2026-11-20T03:00:00Z --lat 60.202778 --lon 11.083889 > "$solar_cli_test_dir/current" 2> "$solar_cli_test_dir/stderr"
  test -s "$solar_cli_test_dir/current"
  test ! -s "$solar_cli_test_dir/stderr"
  if test -f "$solar_cli_test_dir/reference"; then
    cmp "$solar_cli_test_dir/reference" "$solar_cli_test_dir/current"
  else
    cp "$solar_cli_test_dir/current" "$solar_cli_test_dir/reference"
  fi
done
if node dist/cli.js --utc 2026-02-30T03:00:00Z --lat 0 --lon 0 > "$solar_cli_test_dir/stdout" 2> "$solar_cli_test_dir/stderr"; then
  echo 'Invalid date unexpectedly accepted' >&2
  exit 1
fi
test ! -s "$solar_cli_test_dir/stdout"
node --input-type=module - "$solar_cli_test_dir/stderr" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(JSON.parse(readFileSync(process.argv[2],'utf8')).error,'validation_error');
JS
printf '%s\n' 'CLI: four timezones and invalid-date exit/output verified.'
for solar_cli_test_tz in UTC Europe/Oslo America/New_York Pacific/Auckland; do
  TZ="$solar_cli_test_tz" node scripts/route-cli.mjs --utc 2026-11-20T03:00:00Z --plan examples/oslo-tromso.json > "$solar_cli_test_dir/route-current"
  test -s "$solar_cli_test_dir/route-current"
  if test -f "$solar_cli_test_dir/route-reference"; then
    cmp "$solar_cli_test_dir/route-reference" "$solar_cli_test_dir/route-current"
  else
    cp "$solar_cli_test_dir/route-current" "$solar_cli_test_dir/route-reference"
  fi
done
node scripts/route-cli.mjs --utc 2026-03-20T00:00:00Z --plan examples/dark-endpoints.json --mode execute > "$solar_cli_test_dir/route-execution"
node --input-type=module - "$solar_cli_test_dir/route-execution" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const result=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(result.outcome,'solar_death');assert.equal(result.safety.status,'unsafe');
assert.ok(result.safety.event.timeErrorBoundSeconds<=1);
JS
if node scripts/route-cli.mjs --utc 2026-03-20T00:00:00Z --plan examples/missing.json > "$solar_cli_test_dir/stdout" 2> "$solar_cli_test_dir/stderr"; then
  echo 'Missing route file unexpectedly accepted' >&2
  exit 1
fi
test ! -s "$solar_cli_test_dir/stdout"
node --input-type=module - "$solar_cli_test_dir/stderr" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(JSON.parse(readFileSync(process.argv[2],'utf8')).error,'validation_error');
JS
printf '%s\n' 'Route CLI: four timezones, execution stop, invalid-file exit/output verified.'
for simulation_test_tz in UTC Europe/Oslo America/New_York Pacific/Auckland; do
  TZ="$simulation_test_tz" node scripts/simulation-cli.mjs --plan examples/resource-plan.json > "$solar_cli_test_dir/simulation-current"
  if test -f "$solar_cli_test_dir/simulation-reference"; then
    cmp "$solar_cli_test_dir/simulation-reference" "$solar_cli_test_dir/simulation-current"
  else
    cp "$solar_cli_test_dir/simulation-current" "$solar_cli_test_dir/simulation-reference"
  fi
done
node scripts/simulation-cli.mjs --plan examples/resource-plan.json --mode execute > "$solar_cli_test_dir/simulation-execute"
node --input-type=module - "$solar_cli_test_dir/simulation-reference" "$solar_cli_test_dir/simulation-execute" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const forecast=JSON.parse(readFileSync(process.argv[2],'utf8'));
const execution=JSON.parse(readFileSync(process.argv[3],'utf8'));
assert.equal(forecast.outcome,'completed');assert.equal(execution.outcome,'completed');
assert.deepEqual(forecast.state.aircraft,execution.state.aircraft);
assert.deepEqual(forecast.state.warehouses.TOS.foodPersonHours,[0,5000]);
assert.equal(execution.state.warehouses.TOS.foodPersonHours,3000);
assert.equal(Object.hasOwn(execution.state,'stocks'),false);
const fixture=JSON.parse(readFileSync('examples/resource-plan.json','utf8'));
fixture.actions=[{kind:'wait',seconds:1e6}];fixture.stocks.OSL.foodPersonHours=0;fixture.aircraft.foodPersonHours=1;
writeFileSync(process.argv[3]+'.risk',JSON.stringify(fixture));
JS
node scripts/simulation-cli.mjs --plan "$solar_cli_test_dir/simulation-execute.risk" --mode execute > "$solar_cli_test_dir/blocked"
node scripts/simulation-cli.mjs --plan "$solar_cli_test_dir/simulation-execute.risk" --mode execute --confirm-risk > "$solar_cli_test_dir/death"
node --input-type=module - "$solar_cli_test_dir/blocked" "$solar_cli_test_dir/death" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(JSON.parse(readFileSync(process.argv[2],'utf8')).outcome,'risk_confirmation_required');
assert.equal(JSON.parse(readFileSync(process.argv[3],'utf8')).state.death.reason,'food');
JS
if node scripts/simulation-cli.mjs --plan examples/missing.json > "$solar_cli_test_dir/stdout" 2> "$solar_cli_test_dir/stderr"; then
  echo 'Missing simulation file unexpectedly accepted' >&2
  exit 1
fi
test ! -s "$solar_cli_test_dir/stdout"
test -s "$solar_cli_test_dir/stderr"
printf '%s\n' 'Simulation CLI: four timezones, stock visibility, risk confirmation and invalid-file exit verified.'
for waiting_test_tz in UTC Europe/Oslo America/New_York Pacific/Auckland; do
  TZ="$waiting_test_tz" node scripts/simulation-cli.mjs --plan examples/polar-wait.json > "$solar_cli_test_dir/waiting-current"
  if test -f "$solar_cli_test_dir/waiting-reference"; then
    cmp "$solar_cli_test_dir/waiting-reference" "$solar_cli_test_dir/waiting-current"
  else
    cp "$solar_cli_test_dir/waiting-current" "$solar_cli_test_dir/waiting-reference"
  fi
done
node scripts/simulation-cli.mjs --plan examples/polar-wait.json --mode execute > "$solar_cli_test_dir/waiting-execute"
node scripts/simulation-cli.mjs --plan examples/polar-wait.json --mode standing > "$solar_cli_test_dir/standing"
node --input-type=module - "$solar_cli_test_dir/waiting-reference" "$solar_cli_test_dir/waiting-execute" "$solar_cli_test_dir/standing" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const f=read(process.argv[2]),e=read(process.argv[3]),s=read(process.argv[4]);
assert.deepEqual(f,e);assert.equal(e.outcome,'waiting_stopped');
assert.deepEqual(e.waiting.automatic.reasons,['sunrise_warning']);
assert.equal(s.state.currentTimeUtc,s.state.startTimeUtc);
assert.equal(s.waiting.sunrise.requestedEndUtcMs-s.state.currentTimeUtc,370*86400000);
assert.equal(s.waiting.maximum.reason,'sun');
assert.equal(Object.hasOwn(e.state,'stocks'),false);
const fixture=read('examples/polar-wait.json');fixture.actions[0].options={horizonDays:2};
writeFileSync(process.argv[4]+'.invalid',JSON.stringify(fixture));
JS
if node scripts/simulation-cli.mjs --plan "$solar_cli_test_dir/standing.invalid" > "$solar_cli_test_dir/waiting-invalid"; then
  echo 'Short sunrise horizon unexpectedly accepted' >&2
  exit 1
fi
node --input-type=module - "$solar_cli_test_dir/waiting-invalid" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(JSON.parse(readFileSync(process.argv[2],'utf8')).outcome,'validation_error');
JS
printf '%s\n' 'Waiting CLI: four timezones, forecast/execution equality, non-mutating standing analysis and invalid horizon verified.'
