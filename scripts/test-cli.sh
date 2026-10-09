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
