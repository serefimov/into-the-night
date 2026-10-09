import test from 'node:test';
import assert from 'node:assert/strict';
import { solarDirection, solarExposure, surfaceNormal, isSolarSafe, parseUtc, SOLAR_MODEL } from '../dist/core/index.js';
import { reference, angularError, validationReport } from '../scripts/solar-validation.mjs';

test('independent geocentric directions meet 0.05 degree limit throughout sampled interval',()=>{
  assert.equal(reference.samples.length,1346);
  assert.equal(reference.source.version,'2.1.19');
  for(const sample of reference.samples) {
    const direction=solarDirection(Date.parse(sample.utc));
    assert.ok(Math.abs(Math.hypot(...direction)-1)<1e-14,'unit direction at '+sample.utc);
    assert.ok(angularError(direction,sample.direction)<=SOLAR_MODEL.angularValidationLimitDeg,sample.utc);
  }
});

test('altitude agreement includes high latitudes, both poles and horizon timing sensitivity',()=>{
  const report=validationReport();
  assert.ok(report.passed);
  for(const error of Object.values(report.maximumAltitudeErrorDeg))assert.ok(error<=0.05);
  for(const row of report.horizon) {
    assert.ok(Math.abs(row.modelAltitudeAtReferenceDeg)<0.01,row.name);
    // Regression envelopes for these fixtures only; not a universal sunrise accuracy promise.
    const limit=Math.abs(row.latitudeDeg)===90?600:Math.abs(row.latitudeDeg)>=89?90:10;
    assert.ok(Math.abs(row.differenceSeconds)<limit,row.name);
    assert.ok(row.modelSlopeDegPerSecond>0,row.name);
  }
});

test('strict geometric boundary and input rejection',()=>{
  assert.equal(isSolarSafe(-Number.MIN_VALUE),true);
  assert.equal(isSolarSafe(0),false);
  assert.equal(isSolarSafe(-0),false);
  assert.equal(isSolarSafe(Number.MIN_VALUE),false);
  for(const q of [NaN,Infinity,-Infinity,1.01,-1.01])assert.throws(()=>isSolarSafe(q),RangeError);
  for(const utcMs of [NaN,Infinity,-Infinity,Date.UTC(2019,11,31),Date.UTC(2041,0,1)]) {
    assert.throws(()=>solarDirection(utcMs),RangeError);
  }
  for(const position of [null,{}, {latitudeDeg:NaN,longitudeDeg:0},
    {latitudeDeg:91,longitudeDeg:0},{latitudeDeg:0,longitudeDeg:181},
    {latitudeDeg:0,longitudeDeg:Infinity}])assert.throws(()=>surfaceNormal(position),RangeError);
});

test('explicit UTC parsing rejects invalid calendar dates and implicit local time',()=>{
  assert.equal(parseUtc('2024-02-29T23:59:59Z'),Date.UTC(2024,1,29,23,59,59));
  assert.equal(parseUtc('2024-02-29T23:59:59.123Z'),Date.UTC(2024,1,29,23,59,59,123));
  for(const date of ['2023-02-29T00:00:00Z','2024-04-31T00:00:00Z',
    '2026-01-01T24:00:00Z','2026-01-01T00:00:60Z','2026-01-01',
    '2026-01-01T00:00:00','2026-01-01T00:00:00+00:00',
    '2026-01-01T00:00:00.1Z','2041-01-01T00:00:00Z']) {
    assert.throws(()=>parseUtc(date),RangeError,date);
  }
});

test('seasonal illumination reverses between hemispheres and poles ignore longitude',()=>{
  const june=Date.UTC(2026,5,21,12),december=Date.UTC(2026,11,21,12);
  for(const longitudeDeg of [-180,-90,0,90,180]) {
    assert.equal(solarExposure({latitudeDeg:90,longitudeDeg},june).safe,false);
    assert.equal(solarExposure({latitudeDeg:90,longitudeDeg},december).safe,true);
    assert.equal(solarExposure({latitudeDeg:-90,longitudeDeg},june).safe,true);
    assert.equal(solarExposure({latitudeDeg:-90,longitudeDeg},december).safe,false);
    assert.deepEqual(surfaceNormal({latitudeDeg:90,longitudeDeg}),[0,0,1]);
  }
  assert.ok(Math.abs(Math.asin(solarDirection(june)[2])*180/Math.PI-23.44)<0.1);
  const utcMs=parseUtc('2026-03-20T12:00:00Z');
  const day=solarExposure({latitudeDeg:0,longitudeDeg:0},utcMs);
  const night=solarExposure({latitudeDeg:0,longitudeDeg:180},utcMs);
  assert.equal(day.safe,false);assert.equal(night.safe,true);
  assert.ok(Math.abs(day.q+night.q)<1e-14);
  assert.deepEqual(solarExposure({latitudeDeg:30,longitudeDeg:-180},utcMs),
    solarExposure({latitudeDeg:30,longitudeDeg:180},utcMs));
});
