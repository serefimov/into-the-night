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
for session_test_tz in UTC Europe/Oslo America/New_York Pacific/Auckland; do
  TZ="$session_test_tz" node scripts/simulation-cli.mjs --plan examples/resource-plan.json --mode execute --stop-at 2026-01-01T21:15:00Z --save "$solar_cli_test_dir/session.json" > "$solar_cli_test_dir/session-current"
  if test -f "$solar_cli_test_dir/session-reference"; then
    cmp "$solar_cli_test_dir/session-reference" "$solar_cli_test_dir/session-current"
    cmp "$solar_cli_test_dir/save-reference.json" "$solar_cli_test_dir/session.json"
  else
    cp "$solar_cli_test_dir/session-current" "$solar_cli_test_dir/session-reference"
    cp "$solar_cli_test_dir/session.json" "$solar_cli_test_dir/save-reference.json"
  fi
  TZ="$session_test_tz" node scripts/simulation-cli.mjs --restore "$solar_cli_test_dir/session.json" --mode execute > "$solar_cli_test_dir/session-restored-current"
  if test -f "$solar_cli_test_dir/session-restored-reference"; then
    cmp "$solar_cli_test_dir/session-restored-reference" "$solar_cli_test_dir/session-restored-current"
  else
    cp "$solar_cli_test_dir/session-restored-current" "$solar_cli_test_dir/session-restored-reference"
  fi
done
node scripts/simulation-cli.mjs --restore "$solar_cli_test_dir/session.json" --mode forecast > "$solar_cli_test_dir/session-preview"
cmp "$solar_cli_test_dir/session.json" "$solar_cli_test_dir/save-reference.json"
node scripts/simulation-cli.mjs --restore "$solar_cli_test_dir/session.json" --mode execute --stop-after 123.456 --save "$solar_cli_test_dir/session-next.json" > "$solar_cli_test_dir/session-next"
node scripts/simulation-cli.mjs --restore "$solar_cli_test_dir/session-next.json" --mode execute > "$solar_cli_test_dir/session-resumed"
node scripts/simulation-cli.mjs --plan examples/resource-plan.json --mode execute > "$solar_cli_test_dir/session-full"
node --input-type=module - "$solar_cli_test_dir/session-reference" "$solar_cli_test_dir/session-next" "$solar_cli_test_dir/session-resumed" "$solar_cli_test_dir/session-full" "$solar_cli_test_dir/session.json" "$solar_cli_test_dir/session-preview" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const first=read(process.argv[2]),next=read(process.argv[3]),last=read(process.argv[4]),full=read(process.argv[5]);
assert.equal(first.outcome,'paused');assert.equal(first.state.currentTimeUtc,Date.parse('2026-01-01T21:15:00Z'));
assert.equal(first.state.aircraft.activeFlight.stage,'cruise');assert.equal(first.state.aircraft.airportId,null);
assert.deepEqual(first.state.warehouses.TOS.foodPersonHours,[0,5000]);
assert.equal(next.state.currentTimeUtc,first.state.currentTimeUtc+123456);
assert.deepEqual(last.state,full.state);assert.deepEqual(last.events,full.events);
assert.deepEqual([...first.newEvents,...next.newEvents,...last.newEvents],full.events);
assert.equal(read(process.argv[7]).state.warehouses.TOS.foodPersonHours[0],0);
const save=read(process.argv[6]);assert.equal(save.payload.snapshot.currentTimeUtc,first.state.currentTimeUtc);
assert.equal(save.payload.snapshot.activeAction.elapsedSeconds,1800);
save.payload.snapshot.aircraft.fuelKg+=1;
writeFileSync(process.argv[6]+'.broken',JSON.stringify(save));
JS
cp "$solar_cli_test_dir/session.json" "$solar_cli_test_dir/session-protected.json"
if node scripts/simulation-cli.mjs --restore "$solar_cli_test_dir/session.json.broken" --mode execute --save "$solar_cli_test_dir/session-protected.json" > "$solar_cli_test_dir/stdout" 2> "$solar_cli_test_dir/stderr"; then
  echo 'Corrupted save unexpectedly accepted' >&2
  exit 1
fi
test ! -s "$solar_cli_test_dir/stdout"
cmp "$solar_cli_test_dir/session-protected.json" "$solar_cli_test_dir/save-reference.json"
node --input-type=module - "$solar_cli_test_dir/stderr" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const error=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(error.error,'validation_error');assert.match(error.message,/checksum/);
JS
printf '%s\n' 'Session CLI: four timezones, deterministic saves, flight pause/restore/resume, forecast privacy and damaged-save preservation verified.'

for spike_tz in UTC Pacific/Auckland; do
  TZ="$spike_tz" node scripts/spike-cli.mjs --plan examples/spike/plans/direct-90.json > "$solar_cli_test_dir/spike-current"
  if test -f "$solar_cli_test_dir/spike-reference"; then
    cmp "$solar_cli_test_dir/spike-reference" "$solar_cli_test_dir/spike-current"
  else
    cp "$solar_cli_test_dir/spike-current" "$solar_cli_test_dir/spike-reference"
  fi
done
node --input-type=module - "$solar_cli_test_dir/spike-reference" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(report.outcome,'completed');assert.equal(report.survivedDays,90);
assert.ok(report.achievements.includes(90));assert.equal(report.savedResume,true);
assert.equal(report.stages[0].outcome,'completed');
JS
if node scripts/spike-cli.mjs --plan > "$solar_cli_test_dir/stdout" 2> "$solar_cli_test_dir/stderr"; then
  echo 'Invalid spike CLI arguments unexpectedly accepted' >&2
  exit 1
fi
test ! -s "$solar_cli_test_dir/stdout"
node --input-type=module - "$solar_cli_test_dir/stderr" <<'JS'
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert.match(JSON.parse(readFileSync(process.argv[2],'utf8')).error,/Use --research/);
JS
printf '%s\n' 'Spike CLI: deterministic 90-day replay in two timezones and argument validation verified.'

node --input-type=module - "$solar_cli_test_dir/browser-review.json" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {SpikeGame} from './dist/core/game.js';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const game=new SpikeGame(read('data/spike/airports.json'),read('data/spike/scenario.json'));
game.start(game.flight('LYR').actions);game.advance(game.endUtcMs);
game.start([{kind:'service'}]);game.advance(game.endUtcMs);
game.start([{kind:'wait',seconds:30*86400}]);game.advance(game.current().currentTimeUtc+15*86400000);
const save=game.save();game.restore(save);game.cancelGround();
game.start([{kind:'wait',seconds:15*86400}]);game.advance(game.endUtcMs);
writeFileSync(process.argv[2],JSON.stringify(game.journal()));
JS
for review_tz in UTC Pacific/Auckland; do
  TZ="$review_tz" node scripts/review-cli.mjs "$solar_cli_test_dir/browser-review.json" > "$solar_cli_test_dir/review-current"
  if test -f "$solar_cli_test_dir/review-reference"; then
    cmp "$solar_cli_test_dir/review-reference" "$solar_cli_test_dir/review-current"
  else
    cp "$solar_cli_test_dir/review-current" "$solar_cli_test_dir/review-reference"
  fi
done
node --input-type=module - "$solar_cli_test_dir/browser-review.json" "$solar_cli_test_dir/review-current" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=p=>JSON.parse(readFileSync(p,'utf8')),journal=read(process.argv[2]),result=read(process.argv[3]);
assert.equal(result.passed,true);assert.deepEqual(result.state,journal.state);
assert.ok(result.state.achievements.includes(30));assert.ok(journal.entries.some(e=>e.cancelGround));
const clone=()=>JSON.parse(JSON.stringify(journal));
const drift=clone();drift.state.aircraft.fuelKg+=2e-12;drift.state.distanceKm+=5e-13;
writeFileSync(process.argv[2]+'.drift',JSON.stringify(drift));
for(const [suffix,alter] of [
 ['broken',j=>j.state.aircraft.fuelKg+=1e-7],
 ['time',j=>j.state.currentTimeUtc+=0.25],
 ['event',j=>j.entries[0].events[0].utcMs+=0.25],
]){const altered=clone();alter(altered);writeFileSync(process.argv[2]+'.'+suffix,JSON.stringify(altered));}
JS
node scripts/review-cli.mjs "$solar_cli_test_dir/browser-review.json.drift" > "$solar_cli_test_dir/review-drift"
for review_invalid in broken time event; do
if node scripts/review-cli.mjs "$solar_cli_test_dir/browser-review.json.$review_invalid" > "$solar_cli_test_dir/stdout" 2> "$solar_cli_test_dir/stderr"; then
  echo 'Modified browser journal unexpectedly accepted' >&2
  exit 1
fi
test ! -s "$solar_cli_test_dir/stdout"
done
printf '%s\n' 'Browser review CLI: partial wait/stop/save/resume, two timezones and corrupted-state rejection verified.'
