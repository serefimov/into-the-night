// SPDX-License-Identifier: GPL-3.0-only
import {globePoint} from '../../dist/core/globe.js';
import {globeFlightPoint,globeFlightHeading} from '../../dist/core/globe-flight.js';

export function acceptedCruiseRoute(state,acceptedForecast){
 const active=state.activeFlight;
 return active&&acceptedForecast?.refuelling?.airportId===active.fromId&&acceptedForecast?.next?.airportId===active.toId
  ?acceptedForecast.phases.find(p=>p.label==='cruise')?.route:null;
}

/** Display pose only: selection/preview must never steer an executing plane. */
export function flightPlanePose(state,acceptedForecast,frame){
 const cruise=state.phase==='cruise'?acceptedCruiseRoute(state,acceptedForecast):null;
 const fraction=cruise?(state.utcMs-cruise.startUtcMs)/(cruise.endUtcMs-cruise.startUtcMs):null;
 const point=cruise?globeFlightPoint(cruise.path,fraction,frame):globePoint(state.position,frame);
 const heading=cruise?globeFlightHeading(cruise.path,fraction,frame):null;
 return {...point,angleRad:heading??0,directional:heading!==null};
}

/** Fixed billboard at the anchor's depth, nose at (0,-13). Each pixel is
 * occluded by the sphere's front surface, even if the anchor itself is visible.
 * A hidden anchor can still have a wing protruding above the limb. */
export function drawFlightPlane(ctx,pose,frame){
 ctx.save();
 if(pose.depth<1){
  const radius=frame.radius*Math.sqrt(1-Math.max(0,pose.depth)**2);
  ctx.beginPath();ctx.rect(0,0,frame.cx*2,frame.cy*2);
  ctx.moveTo(frame.cx+radius,frame.cy);
  ctx.arc(frame.cx,frame.cy,radius,0,Math.PI*2);ctx.clip('evenodd');
 }
 ctx.translate(pose.x,pose.y);ctx.rotate(pose.angleRad);
 ctx.beginPath();
 const contour=[[0,-13],[2,-10],[2,-3],[11,3],[11,6],[2,3],[2,9],[5,11],[5,13],[0,11],[-5,13],[-5,11],[-2,9],[-2,3],[-11,6],[-11,3],[-2,-3],[-2,-10]];
 contour.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
 ctx.fillStyle='#fff4dd';ctx.strokeStyle='#07131e';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.stroke();ctx.fill();ctx.restore();
}
