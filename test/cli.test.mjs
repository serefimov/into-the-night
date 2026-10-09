import test from 'node:test';
import assert from 'node:assert/strict';
import { solarCliOutput } from '../dist/cli-command.js';
const args=['--utc','2026-11-20T03:00:00Z','--lat','60.202778','--lon','11.083889'];
test('CLI command accepts explicit UTC and outputs versioned JSON',()=>{
 const output=JSON.parse(solarCliOutput(args));
 assert.equal(output.utc,'2026-11-20T03:00:00.000Z');assert.equal(output.safe,true);
 assert.equal(output.direction.length,3);assert.ok(output.altitudeDeg<0);
 assert.equal(output.modelVersion,'meeus-noaa-1');
 assert.match(solarCliOutput(['--help']),/^Usage:/);
});
test('CLI command rejects bad or ambiguous arguments',()=>{
 for(const bad of [[],args.slice(0,-2),[...args,'--lat','1'],[...args,'--unknown','1'],
  ['--utc','2026-01-01T00:00:00','--lat','0','--lon','0'],
  ['--utc','2026-01-01T00:00:00Z','--lat','91','--lon','0'],
  ['--utc','2026-01-01T00:00:00Z','--lat','NaN','--lon','0'],
  ['--utc','2026-01-01T00:00:00Z','--lat','','--lon','0'],
  ['--utc','2026-01-01T00:00:00Z','--lat','0x10','--lon','0']]) {
   assert.throws(()=>solarCliOutput(bad),RangeError);
 }
});
