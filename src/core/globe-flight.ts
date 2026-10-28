// SPDX-License-Identifier: GPL-3.0-only
import {greatCircleNormal,greatCirclePosition} from './geometry.js';
import type {GreatCircle} from './geometry.js';
import {globePoint} from './globe.js';
import type {GlobeFrame,GlobePoint} from './globe.js';
import type {Vector3} from './solar.js';

// Exaggerated display height, NOT a physical altitude. Ground endpoints and a
// smooth ramp over the first/last 5% avoid jumps at the cruise phase boundaries.
const HEIGHT=.025, RAMP=.05;
const dot=(a:Vector3,b:Vector3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function flightRadius(fraction:number):{radius:number;slope:number} {
 const t=Math.min(fraction,1-fraction)/RAMP;
 if(t>=1)return {radius:1+HEIGHT,slope:0};
 return {radius:1+HEIGHT*t*t*(3-2*t),slope:HEIGHT*6*t*(1-t)/RAMP*(fraction<.5?1:-1)};
}

export function globeFlightPoint(path:GreatCircle,fraction:number,frame:GlobeFrame):GlobePoint {
 return globePoint(greatCirclePosition(path,fraction),frame,flightRadius(fraction).radius);
}

/** Project d(r(f) n(f))/df, including the radial part during the visual ramps. */
export function globeFlightHeading(path:GreatCircle,fraction:number,frame:GlobeFrame):number|null {
 const normal=greatCircleNormal(path,fraction),angle=path.angleRad*fraction;
 const {radius,slope}=flightRadius(fraction),c=Math.cos(angle),s=Math.sin(angle);
 const speed=radius*path.angleRad;
 const tangent:Vector3=[
  speed*(path.tangent[0]*c-path.start[0]*s)+slope*normal[0],
  speed*(path.tangent[1]*c-path.start[1]*s)+slope*normal[1],
  speed*(path.tangent[2]*c-path.start[2]*s)+slope*normal[2],
 ];
 const length=Math.hypot(...tangent),right=dot(tangent,frame.east),up=dot(tangent,frame.north);
 return Math.hypot(right,up)<1e-6*length?null:Math.atan2(right,up);
}

export interface GlobeFlightLines {front:GlobePoint[][];back:GlobePoint[][]}
/** Curved display trajectory split at the centre plane for painter ordering:
 * draw back lines, then the opaque Earth, then front lines. This preserves the
 * parts of the rear arc outside the limb without leaking through the sphere.
 * Subdivide to 0.2 CSS px chord error (quarter/midpoint probes), at most 2°.
 * Include the current fraction so the plane anchor is exactly a line vertex. */
export function globeFlightLines(path:GreatCircle,frame:GlobeFrame,currentFraction?:number):GlobeFlightLines {
 const fractions=[0,RAMP,1-RAMP,1];
 if(currentFraction!==undefined){greatCircleNormal(path,currentFraction);fractions.push(currentFraction);}
 fractions.sort((a,b)=>a-b);
 const samples=[{fraction:0,point:globeFlightPoint(path,0,frame)}];
 function append(from:number,to:number,a:GlobePoint,b:GlobePoint):void {
  if(to===from)return;
  const span=to-from;
  const curved=[.25,.5,.75].some(t=>{
   const p=globeFlightPoint(path,from+span*t,frame);
   return Math.hypot(p.x-a.x-(b.x-a.x)*t,p.y-a.y-(b.y-a.y)*t)>.2;
  });
  if(path.angleRad*span>Math.PI/90||curved){
   const mid=(from+to)/2,p=globeFlightPoint(path,mid,frame);
   append(from,mid,a,p);append(mid,to,p,b);
  }else samples.push({fraction:to,point:b});
 }
 for(let i=1;i<fractions.length;i++){
  const from=fractions[i-1]!,to=fractions[i]!;
  append(from,to,globeFlightPoint(path,from,frame),globeFlightPoint(path,to,frame));
 }
 const lines:GlobeFlightLines={front:[],back:[]};
 let previous=samples[0]!,front=previous.point.depth>=0,line=[previous.point];
 for(const sample of samples.slice(1)){
  const nextFront=sample.point.depth>=0;
  if(front!==nextFront){
   let low=previous.fraction,high=sample.fraction;
   for(let i=0;i<40;i++){
    const mid=(low+high)/2;
    if((globeFlightPoint(path,mid,frame).depth>=0)===front)low=mid;else high=mid;
   }
   const crossing=globeFlightPoint(path,(low+high)/2,frame);
   line.push(crossing);lines[front?'front':'back'].push(line);line=[crossing];front=nextFront;
  }
  line.push(sample.point);previous=sample;
 }
 if(line.length>1)lines[front?'front':'back'].push(line);
 return lines;
}
