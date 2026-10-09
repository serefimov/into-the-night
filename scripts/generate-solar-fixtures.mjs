// Independent oracle only: no imports from src/ or dist/.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const enginePath = process.argv[2] ?? 'astronomy-engine';
const A = require(enginePath);
const DEG = Math.PI / 180;
function direction(utcMs) {
  const time = new A.AstroTime(new Date(utcMs));
  const eqj = A.GeoVector(A.Body.Sun, time, true);
  const eqd = A.RotateVector(A.Rotation_EQJ_EQD(time), eqj);
  const angle = A.SiderealTime(time) * 15 * DEG;
  const length = Math.hypot(eqd.x, eqd.y, eqd.z);
  return [(eqd.x * Math.cos(angle) + eqd.y * Math.sin(angle)) / length,
    (-eqd.x * Math.sin(angle) + eqd.y * Math.cos(angle)) / length, eqd.z / length];
}
function q(utcMs, latitudeDeg, longitudeDeg) {
  const s = direction(utcMs);
  const phi = latitudeDeg * DEG, lambda = longitudeDeg * DEG;
  if (Math.abs(latitudeDeg) === 90) return Math.sign(latitudeDeg) * s[2];
  return Math.cos(phi) * Math.cos(lambda) * s[0] + Math.cos(phi) * Math.sin(lambda) * s[1] + Math.sin(phi) * s[2];
}
const dates = new Set(['2020-01-01T00:00:00.000Z','2040-12-31T23:59:59.999Z']);
for(let year=2020;year<=2040;year++) {
  for(let month=0;month<12;month++) for(const hour of [0,6,12,18]) {
    dates.add(new Date(Date.UTC(year,month,15,hour)).toISOString());
  }
  for(const [month,day] of [[2,20],[5,21],[8,22],[11,21]]) for(const hour of [0,6,12,18]) {
    dates.add(new Date(Date.UTC(year,month,day,hour)).toISOString());
  }
}
const samples = [...dates].sort().map(utc=>({utc,direction:direction(Date.parse(utc))}));
const cases = [
 ['equator',0,0,'2026-03-20','2026-03-21'],
 ['greenwich',51.4779,0,'2026-06-21','2026-06-22'],
 ['tromso',69.681389,18.917778,'2026-03-20','2026-03-21'],
 ['longyearbyen',78.246111,15.465556,'2026-02-10','2026-03-01'],
 ['near-north-pole',89,0,'2026-03-01','2026-04-01'],
 ['near-south-pole',-89,0,'2026-09-01','2026-10-01'],
 ['north-pole',90,0,'2026-03-01','2026-04-01'],
 ['south-pole',-90,0,'2026-09-01','2026-10-01'],
];
const horizon = cases.map(([name,latitudeDeg,longitudeDeg,start,end])=>{
  const startMs=Date.parse(start+'T00:00:00Z'), endMs=Date.parse(end+'T00:00:00Z');
  let lo=startMs, hi;
  for(let t=startMs+3600000;t<=endMs;t+=3600000) {
    if(q(lo,latitudeDeg,longitudeDeg)<0 && q(t,latitudeDeg,longitudeDeg)>=0) {hi=t;break;}
    lo=t;
  }
  if(hi===undefined) throw new Error('No rising crossing for '+name);
  const bracketStartUtc=new Date(lo).toISOString(), bracketEndUtc=new Date(hi).toISOString();
  while(hi-lo>1) {const mid=Math.floor((lo+hi)/2);if(q(mid,latitudeDeg,longitudeDeg)>=0)hi=mid;else lo=mid;}
  return {name,latitudeDeg,longitudeDeg,bracketStartUtc,bracketEndUtc,referenceUtc:new Date(hi).toISOString(),direction:direction(hi)};
});
const fixture={
 schemaVersion:1,
 source:{name:'Astronomy Engine',version:'2.1.19',license:'MIT',
  commit:'61dc07020aaa6885d2c7f688a4d82beaf6edb9ef',
  url:'https://github.com/cosinekitty/astronomy/tree/v2.1.19',
  method:'GeoVector(Sun, aberration=true) -> Rotation_EQJ_EQD -> -SiderealTime; geocentric center, no refraction/parallax',
  timeConvention:'Astronomy Engine UTC/UT with its internal DeltaT -> TT; Earth rotation via GAST',
  dataLicense:'GPL-3.0-only; generated numerical fixtures for Into the Night',
 },
 intervalUtc:['2020-01-01T00:00:00.000Z','2041-01-01T00:00:00.000Z'],
 samples,horizon,
};
writeFileSync(new URL('../test/fixtures/solar-reference.json',import.meta.url),JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({samples:samples.length,horizon:horizon.length}));
