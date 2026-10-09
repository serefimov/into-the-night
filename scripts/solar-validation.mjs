import { readFileSync } from 'node:fs';
import { solarDirection, solarExposure, SOLAR_MODEL } from '../dist/core/index.js';
export const reference = JSON.parse(readFileSync(new URL('../test/fixtures/solar-reference.json',import.meta.url),'utf8'));
const RAD_TO_DEG=180/Math.PI;
export function angularError(a,b) {
  const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  return Math.atan2(Math.hypot(...cross),a[0]*b[0]+a[1]*b[1]+a[2]*b[2])*RAD_TO_DEG;
}
// Test/report utility only. Not a production first-sunrise search.
export function modelCrossing(sample) {
  let lo=Date.parse(sample.bracketStartUtc),hi=Date.parse(sample.bracketEndUtc);
  const position={latitudeDeg:sample.latitudeDeg,longitudeDeg:sample.longitudeDeg};
  const q=t=>solarExposure(position,t).q;
  if(q(lo)>=0||q(hi)<0) throw new Error('Reference bracket no longer contains model crossing: '+sample.name);
  while(hi-lo>1) {const mid=Math.floor((lo+hi)/2);if(q(mid)>=0)hi=mid;else lo=mid;}
  return hi;
}
export function validationReport() {
  let maximum={errorDeg:0,utc:''};
  const altitudeErrors={ordinary:0,highLatitude:0,poles:0};
  for(const sample of reference.samples) {
    const utcMs=Date.parse(sample.utc),errorDeg=angularError(solarDirection(utcMs),sample.direction);
    if(errorDeg>maximum.errorDeg)maximum={errorDeg,utc:sample.utc};
    for(const latitudeDeg of [-90,-89,-78.246111,-69.681389,0,51.4779,69.681389,78.246111,89,90]) {
      for(const longitudeDeg of [-180,-90,0,90,180]) {
        const phi=latitudeDeg/RAD_TO_DEG,lambda=longitudeDeg/RAD_TO_DEG;
        const n=Math.abs(latitudeDeg)===90?[0,0,Math.sign(latitudeDeg)]:[Math.cos(phi)*Math.cos(lambda),Math.cos(phi)*Math.sin(lambda),Math.sin(phi)];
        const q=n.reduce((sum,v,i)=>sum+v*sample.direction[i],0);
        const refAltitude=Math.asin(Math.max(-1,Math.min(1,q)))*RAD_TO_DEG;
        const error=Math.abs(solarExposure({latitudeDeg,longitudeDeg},utcMs).altitudeDeg-refAltitude);
        const group=Math.abs(latitudeDeg)===90?'poles':Math.abs(latitudeDeg)>=69?'highLatitude':'ordinary';
        altitudeErrors[group]=Math.max(altitudeErrors[group],error);
      }
    }
  }
  const horizon=reference.horizon.map(sample=>{
    const utcMs=Date.parse(sample.referenceUtc),modelUtcMs=modelCrossing(sample);
    const position={latitudeDeg:sample.latitudeDeg,longitudeDeg:sample.longitudeDeg};
    const rate=(solarExposure(position,utcMs+30000).altitudeDeg-solarExposure(position,utcMs-30000).altitudeDeg)/60;
    return {name:sample.name,latitudeDeg:sample.latitudeDeg,longitudeDeg:sample.longitudeDeg,
      referenceUtc:sample.referenceUtc,modelUtc:new Date(modelUtcMs).toISOString(),
      differenceSeconds:(modelUtcMs-utcMs)/1000,
      modelAltitudeAtReferenceDeg:solarExposure(position,utcMs).altitudeDeg,
      modelSlopeDegPerSecond:rate};
  });
  return {modelVersion:SOLAR_MODEL.version,referenceVersion:reference.source.version,
    samples:reference.samples.length,maximumDirectionError:maximum,
    maximumAltitudeErrorDeg:altitudeErrors,horizon,
    passed:maximum.errorDeg<=SOLAR_MODEL.angularValidationLimitDeg};
}
