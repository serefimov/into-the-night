// SPDX-License-Identifier: GPL-3.0-only
import {globePoint,globeRouteHeading} from '../../dist/core/globe.js';

/** Display pose only: selection/preview must never steer an executing plane. */
export function flightPlanePose(state,acceptedForecast,frame){
 const point=globePoint(state.position,frame),active=state.activeFlight;
 const cruise=state.phase==='cruise'&&active&&acceptedForecast?.refuelling?.airportId===active.fromId&&acceptedForecast?.next?.airportId===active.toId
  ?acceptedForecast.phases.find(p=>p.label==='cruise'):null;
 const heading=cruise?.route.path?globeRouteHeading(cruise.route.path,state.position,frame):null;
 // Preserve the existing 13 px lift above the position/airport marker.
 return {...point,y:point.y-13,angleRad:heading??0,directional:heading!==null};
}

/** Fixed silhouette, nose at (0,-13); the position is the centre of the symbol. */
export function drawFlightPlane(ctx,pose){
 if(!pose.visible)return;
 ctx.save();ctx.translate(pose.x,pose.y);ctx.rotate(pose.angleRad);
 ctx.beginPath();
 const contour=[[0,-13],[2,-10],[2,-3],[11,3],[11,6],[2,3],[2,9],[5,11],[5,13],[0,11],[-5,13],[-5,11],[-2,9],[-2,3],[-11,6],[-11,3],[-2,-3],[-2,-10]];
 contour.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();
 ctx.fillStyle='#fff4dd';ctx.strokeStyle='#07131e';ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.stroke();ctx.fill();ctx.restore();
}
