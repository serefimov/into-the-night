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
