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
   g.focus({...s.position,longitudeDeg:((s.position.longitudeDeg+${offset}+180)%360+360)%360-180},${zoom});a.render();
   const {globeFlightPoint,globeFlightLines}=await import('../../dist/core/globe-flight.js');
   const p=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route,f=(s.utcMs-p.startUtcMs)/(p.endUtcMs-p.startUtcMs);
   const before=globeFlightPoint(p.path,Math.max(0,f-1e-6),g.frame),after=globeFlightPoint(p.path,Math.min(1,f+1e-6),g.frame);
   const dx=after.x-before.x,dy=after.y-before.y,pose=g.planePose;
   const lines=globeFlightLines(p.path,g.frame,f),points=[...lines.front.flat(),...lines.back.flat()];
   return {pose,anchorError:Math.min(...points.map(q=>Math.hypot(q.x-pose.x,q.y-pose.y))),alignment:(Math.sin(pose.angleRad)*dx-Math.cos(pose.angleRad)*dy)/Math.hypot(dx,dy)};})()`);
  assert.ok(result.anchorError<1e-9,label+': plane anchor must lie on the spatial route');
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
  await inspectSpatialOcclusion({app,evaluate,send,mobile});
 }
}

/** Synthetic equatorial fixture isolates native Canvas occlusion from mission
 * safety. It uses the real renderer, and restores its data/camera afterwards. */
async function inspectSpatialOcclusion({app,evaluate,send,mobile}){
 const result=await evaluate(`(async()=>{
  const a=${app},g=a.globe,data=g.data,camera={...g.camera},saved=a.controller.session.save();
  const {greatCircle}=await import('../../dist/core/geometry.js');
  const {globeFrame,globePoint}=await import('../../dist/core/globe.js');
  const {drawFlightPlane}=await import('./plane.mjs');
  const at=longitudeDeg=>({latitudeDeg:0,longitudeDeg});
  const original={...data,airports:[],tracks:[],forecast:null,acceptedForecast:null,
   state:{...data.state,phase:'planning',activeFlight:null,position:at(180)}};
  const pixels=()=>g.ctx.getImageData(0,0,g.canvas.width,g.canvas.height).data;
  const counts=[];
  try{
   g.focus(at(0),.75);g.update(original);g.draw(data.state.utcMs);
   const baseline=pixels(),dpr=g.canvas.width/g.geometry.width;
   for(const longitude of [95,103,150]){
    const path=greatCircle(at(longitude-5),at(longitude+5));
    const cruise={path,startUtcMs:0,endUtcMs:2};
    const forecast={allowed:true,refuelling:{airportId:'from'},next:{airportId:'to'},phases:[{label:'cruise',route:cruise}]};
    const fixture={...original,forecast,acceptedForecast:forecast,state:{...original.state,phase:'cruise',utcMs:1,
     position:at(longitude),activeFlight:{fromId:'from',toId:'to'}}};
    g.update(fixture);g.draw(data.state.utcMs);
    const image=pixels(),pose=g.planePose;
    // Hide only the airplane; the accepted route must still paint above the limb.
    g.update({...fixture,state:{...fixture.state,phase:'departure',position:at(180)}});g.draw(data.state.utcMs);
    const lineOnly=pixels();let interiorChanges=0,exteriorChanges=0,lineExteriorChanges=0,planeExteriorChanges=0;
    for(let y=0;y<g.canvas.height;y++)for(let x=0;x<g.canvas.width;x++){
     const i=(y*g.canvas.width+x)*4;
     const changed=[0,1,2,3].some(c=>image[i+c]!==baseline[i+c]);
     const distance=Math.hypot((x+.5)/dpr-g.frame.cx,(y+.5)/dpr-g.frame.cy);
     if(changed&&distance<g.frame.radius-3)interiorChanges++;
     if(changed&&distance>g.frame.radius+3)exteriorChanges++;
     if(distance>g.frame.radius+1&&[0,1,2,3].some(c=>lineOnly[i+c]!==baseline[i+c]))lineExteriorChanges++;
     if(distance>g.frame.radius+1&&[0,1,2,3].some(c=>image[i+c]!==lineOnly[i+c]))planeExteriorChanges++;
    }
    counts.push({longitude,interiorChanges,exteriorChanges,lineExteriorChanges,planeExteriorChanges,pose});
   }
   // A front billboard also needs per-pixel depth clipping: its inner wing can
   // intersect Earth's front surface while its centre remains visible.
   const canvas=new OffscreenCanvas(300,300),ctx=canvas.getContext('2d'),frame=globeFrame(at(0),300,300);
   const pose={...globePoint(at(65),frame,1.025),angleRad:0};
   drawFlightPlane(ctx,pose,frame);
   const image=ctx.getImageData(0,0,300,300).data,occluder=frame.radius*Math.sqrt(1-pose.depth**2);
   let hiddenPixels=0,visiblePixels=0;
   for(let y=0;y<300;y++)for(let x=0;x<300;x++)if(image[(y*300+x)*4+3]){
    if(Math.hypot(x+.5-frame.cx,y+.5-frame.cy)<occluder-1)hiddenPixels++;else visiblePixels++;
   }
   return {counts,hiddenPixels,visiblePixels,unchanged:a.controller.session.save()===saved};
  }finally{g.update(data);g.focus(camera,camera.zoom);a.render();}
 })()`);
 assert.equal(result.unchanged,true);
 assert.equal(result.hiddenPixels,0,'The front billboard must not show through the sphere surface');
 assert.ok(result.visiblePixels>0);
 for(const row of result.counts)assert.equal(row.interiorChanges,0,'Rear line and silhouette must not leak through the Earth');
 assert.equal(result.counts[0].pose.visible,true,'A plane behind the centre plane but above the limb remains visible');
 assert.ok(result.counts[0].exteriorChanges>0,'Rear geometry outside the limb is actually painted');
 assert.ok(result.counts[0].lineExteriorChanges>0,'The rear route itself remains visible above the limb without an airplane');
 assert.equal(result.counts[1].pose.visible,false,'The sphere hides the anchor below the limb');
 assert.ok(result.counts[1].planeExteriorChanges>0,'A protruding part of the silhouette remains visible when its anchor is hidden');
 assert.equal(result.counts[2].exteriorChanges,0,'A fully occluded route and airplane leave no pixels outside Earth');
 // Photograph a real paused flight from beside its route, not the synthetic fixture.
 await evaluate(`(async()=>{
  const a=${app},s=a.controller.view.state,{surfaceNormal}=await import('../../dist/core/solar.js');
  const {normalCoordinates}=await import('../../dist/core/geometry.js');
  const n=surfaceNormal(s.position),lon=s.position.longitudeDeg*Math.PI/180,east=[-Math.sin(lon),Math.cos(lon),0];
  const angle=95*Math.PI/180,center=normalCoordinates(n.map((v,i)=>v*Math.cos(angle)+east[i]*Math.sin(angle)));
  a.globe.focus(center,.75);a.render();
 })()`);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 await writeFile(`.build/previews/plane-horizon-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));
 await evaluate(`${app}.globe.focus(${app}.controller.view.state.position,1);${app}.render()`);
}
