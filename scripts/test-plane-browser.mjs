// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
/** Check the rendered pose against a short forward step of the accepted arc.
 * Camera/selection changes must preserve the complete saved physical state. */
export async function inspectPausedPlane({app,evaluate,send,mobile,label}){
 const initial=await evaluate(`${app}.controller.session.save()`),selected=await evaluate(`${app}.controller.selectedId`);
 assert.equal(await evaluate(`${app}.controller.view.state.phase`),'cruise');
 const angles=[];
 for(const [offset,zoom] of [[-35,1],[35,1],[35,3]]){
  const result=await evaluate(`(async()=>{const a=${app},g=a.globe,s=a.controller.view.state;
   g.focus({...s.position,longitudeDeg:s.position.longitudeDeg+${offset}},${zoom});a.render();
   const {globePoint}=await import('../../dist/core/globe.js'),{greatCirclePosition}=await import('../../dist/core/geometry.js');
   const p=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route,f=(s.utcMs-p.startUtcMs)/(p.endUtcMs-p.startUtcMs);
   const before=globePoint(greatCirclePosition(p.path,Math.max(0,f-1e-6)),g.frame),after=globePoint(greatCirclePosition(p.path,Math.min(1,f+1e-6)),g.frame);
   const dx=after.x-before.x,dy=after.y-before.y,pose=g.planePose;
   return {pose,alignment:(Math.sin(pose.angleRad)*dx-Math.cos(pose.angleRad)*dy)/Math.hypot(dx,dy)};})()`);
  assert.equal(result.pose.visible,true);assert.equal(result.pose.directional,true);assert.ok(result.alignment>.999999,label+': nose must follow the projected local forward motion');angles.push(result.pose.angleRad);
  assert.equal(await evaluate(`${app}.controller.session.save()`),initial);
 }
 assert.ok(Math.abs(angles[0]-angles[1])>.01,'Rotating the paused camera changes the screen heading');assert.ok(Math.abs(angles[1]-angles[2])<1e-9,'Zoom must not change the angle');
 const angle=await evaluate(`${app}.globe.planePose.angleRad`);
 await evaluate(`${app}.select('UNNT')`);assert.equal(await evaluate(`${app}.globe.planePose.angleRad`),angle);assert.equal(await evaluate(`${app}.controller.session.save()`),initial);
 await evaluate(`${app}.select(${JSON.stringify(selected)});${app}.globe.focus(${app}.controller.view.state.position,1);${app}.render()`);
 if(label==='first-cruise'){
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await mkdir('.build/previews',{recursive:true});await writeFile(`.build/previews/plane-heading-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));
  if(process.env.GLOBE_PREVIEW_LOG==='1')console.log(`PLANE_HEADING_${mobile?'MOBILE':'DESKTOP'} ${shot.data}`);
 }
}
