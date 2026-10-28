// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
import {openFlightPage} from './browser-navigation.mjs';
const base=await loadCycleDefinition();
export async function centerScenarioRun({send,evaluate,until,click,rootUrl,mobile}){
 const app='window.centerApp';
 async function open(){await openFlightPage({send,evaluate,until,rootUrl});await evaluate(`import('./app.mjs').then(m=>{window.centerApp=m.app;return true;})`);}
 async function metrics(width=mobile?390:1280){await send('Emulation.setDeviceMetricsOverride',{width,height:mobile?844:900,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});}
 async function key(key,code,windowsVirtualKeyCode){const params={key,code,windowsVirtualKeyCode,nativeVirtualKeyCode:windowsVirtualKeyCode},text=key==='Enter'?String.fromCharCode(13):key===' '?' ':null;await send('Input.dispatchKeyEvent',{type:'keyDown',...params,...(text===null?{}:{text})});await send('Input.dispatchKeyEvent',{type:'keyUp',...params});}
 async function inspect(){return evaluate(`(()=>{const a=${app},g=a.globe,s=a.controller.view.state,b=document.getElementById('plane-focus'),r=b.getBoundingClientRect(),canvas=g.canvas.getBoundingClientRect(),p=g.planePose;
  const overlaps=(x,y,w,h)=>r.left<x+w&&r.right>x&&r.top<y+h&&r.bottom>y;
  const selected=g.nodes.get(a.controller.selectedId),sr=selected?.getBoundingClientRect();
  return {camera:g.camera,position:s.position,zoom:g.camera.zoom,visible:p.visible,centered:Math.hypot(p.x-g.frame.cx,p.y-g.frame.cy)<1e-7,planeBlocked:overlaps(canvas.left+p.x-15,canvas.top+p.y-15,30,30),selectedBlocked:sr?overlaps(sr.left,sr.top,sr.width,sr.height):false,button:{w:r.width,h:r.height,shown:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,label:b.textContent.trim(),aria:b.getAttribute('aria-label'),svg:b.querySelectorAll('svg').length,clipped:b.scrollWidth>b.clientWidth},playing:a.controller.playing};})()`);}
 async function center(zoom,keyboard=null){
  const before=await evaluate(`({save:${app}.controller.session.save(),selected:${app}.controller.selectedId,tracks:JSON.stringify(${app}.controller.tracks)})`);
  await evaluate(`(()=>{const a=${app},p=a.controller.view.state.position;a.globe.focus({latitudeDeg:-p.latitudeDeg,longitudeDeg:((p.longitudeDeg+360)%360)-180},${zoom});a.globe.onInteraction();a.render();})()`);
  assert.equal(await evaluate(`${app}.globe.planePose.visible`),false,'Move the plane behind the globe before returning');
  if(keyboard){await evaluate(`document.getElementById('plane-focus').focus()`);await key(...keyboard);}else await click('#plane-focus',mobile);
  try{await until(`!${app}.globe.dirty && Math.abs(${app}.globe.camera.latitudeDeg-${app}.controller.view.state.position.latitudeDeg)<1e-9`);}catch(error){throw Error(`Center failed at ${zoom}x (${keyboard?.[1]??'pointer'}): ${JSON.stringify(await inspect())}; ${error.message}`);}
  const r=await inspect();assert.equal(r.zoom,zoom);assert.deepEqual({latitudeDeg:r.camera.latitudeDeg,longitudeDeg:r.camera.longitudeDeg},r.position);assert.equal(r.visible,true);assert.equal(r.centered,true);assert.equal(r.planeBlocked,false);assert.equal(r.selectedBlocked,false);assert.equal(r.playing,false);
  assert.ok(r.button.w>=44&&r.button.h>=44);assert.equal(r.button.shown,true);assert.equal(r.button.label,'Центрировать');assert.match(r.button.aria,/Центрировать.*самолёте/);assert.equal(r.button.svg,1);assert.equal(r.button.clipped,false);
  assert.deepEqual(await evaluate(`({save:${app}.controller.session.save(),selected:${app}.controller.selectedId,tracks:JSON.stringify(${app}.controller.tracks)})`),before);
 }
 async function fly(id,fraction=null){
  await evaluate(`${app}.select(${JSON.stringify(id)})`);await click('#fly',mobile);await click('#play-pause',mobile);
  await evaluate(`(()=>{const a=${app},p=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route;a.advanceTo(${fraction===null?'a.controller.session.endUtcMs':`p.startUtcMs+(p.endUtcMs-p.startUtcMs)*${fraction}`});})()`);
 }
 await metrics();await open();
 assert.equal(await evaluate(`document.querySelectorAll('#plane-focus').length`),1);
 await evaluate(`${app}.select('BIKF')`);
 await center(.75);await center(3,['Enter','Enter',13]);await center(5,[' ','Space',32]);
 await fly('BIKF',.4);await center(3);await center(5,['Enter','Enter',13]);
 // Freeze wall-clock playback only in the test, then allow one real state advance
 // through RAF: this proves following without racing screenshots against time.
 await evaluate(`(()=>{const c=${app}.controller;window.centerOriginalTick=c.tick;c.tick=()=>false;c.play(performance.now());})()`);
 await tickOnce();assert.equal((await inspect()).centered,true,'Centering on pause must arm following for resume');
 await evaluate(`(()=>{const a=${app},c=a.controller,p=c.view.state.position;c.tick=()=>false;c.play(performance.now());a.globe.onInteraction();a.globe.focus({latitudeDeg:-p.latitudeDeg,longitudeDeg:((p.longitudeDeg+360)%360)-180},5);a.render();})()`);
 await click('#plane-focus',mobile);
 assert.equal(await evaluate(`${app}.controller.playing`),true);
 const unchanged=await evaluate(`(()=>{const a=${app},before=a.controller.session.save(),selected=a.controller.selectedId,zoom=a.globe.camera.zoom;document.getElementById('plane-focus').click();return before===a.controller.session.save()&&selected===a.controller.selectedId&&zoom===a.globe.camera.zoom;})()`);assert.equal(unchanged,true);
 async function tickOnce(){const utc=await evaluate(`${app}.controller.view.state.utcMs+1000`);await evaluate(`${app}.controller.tick=function(now){this.advanceTo(${utc},now);this.playing=false;this.tick=window.centerOriginalTick;return true;}`);await until(`${app}.controller.view.state.utcMs===${utc} && !${app}.globe.dirty`);}
 await tickOnce();assert.equal((await inspect()).centered,true);assert.equal((await inspect()).zoom,5);
 // A real keyboard pan disables following; the next physical tick keeps that camera.
 await evaluate(`(()=>{const c=${app}.controller;c.tick=()=>false;c.play(performance.now());document.getElementById('globe').focus();})()`);
 await key('ArrowLeft','ArrowLeft',37);await until(`!${app}.globe.dirty`);
 const rotated=await evaluate(`({...${app}.globe.camera})`);await tickOnce();assert.deepEqual(await evaluate(`({...${app}.globe.camera})`),rotated);
 await center(1);
 if(mobile){await metrics(320);await until(`!${app}.globe.dirty`);await center(1);await metrics();await until(`!${app}.globe.dirty`);await center(1);}
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await mkdir('.build/previews',{recursive:true});await writeFile(`.build/previews/center-plane-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));if(process.env.GLOBE_PREVIEW_LOG==='1')console.log(`CENTER_PLANE_${mobile?'MOBILE':'DESKTOP'} ${shot.data}`);
 await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);await fly('CYEG');await fly('UHMA',.94);await center(3);await evaluate(`(()=>{const a=${app},p=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route;a.advanceTo(p.startUtcMs+(p.endUtcMs-p.startUtcMs)*.98);})()`);await center(5);
 // Explicit synthetic winter polar fixture: same real aircraft/physics, tiny
 // catalogue for navigation near 89 degrees; it is not a campaign witness.
 const polar=structuredClone(base);polar.scenarioId='synthetic-center-polar';polar.worldVersion='synthetic-center-world';polar.seed='center-polar-40';polar.airports=[{id:'A',name:'Полярный тест A',latitudeDeg:89,longitudeDeg:179,suitability:{status:'screened-candidate'}},{id:'B',name:'Полярный тест B',latitudeDeg:88,longitudeDeg:-179,suitability:{status:'screened-candidate'}}];polar.targetId='B';polar.initial={airportId:'A',utcMs:Date.parse('2026-12-21T00:00:00Z'),fuelKg:30000,stocks:{A:64000,B:64000}};
 const source=`(()=>{const original=window.fetch.bind(window);window.fetch=(input,...args)=>String(input).endsWith('/data/runtime/mission.json')?Promise.resolve(new Response(${JSON.stringify(JSON.stringify(polar))},{headers:{'Content-Type':'application/json'}})):original(input,...args);})()`;
 const script=(await send('Page.addScriptToEvaluateOnNewDocument',{source})).identifier;
 try{await open();await center(.75);await center(5,[' ','Space',32]);await fly('B',.5);await center(3);assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);}
 finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});}
 return {viewport:mobile?'390x844 and 320x844 touch':'1280x900 mouse',passed:true,steps:['one visible labelled SVG return control','mouse/touch/Enter/Space','hidden plane to actual position without zoom reset','planning and paused cruise preserve save/selection/route','following restored without starting paused time','manual pan disables following','date-line and polar positions','no blocked plane or selected marker']};
}
