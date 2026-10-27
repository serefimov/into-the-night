// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {loadCycleDefinition} from './mission-cycle-data.mjs';

// All position fixtures go through MissionSession. The polar fixture tests UI
// geometry only; it is not a claimed playable airport or campaign route.
export async function centerScenarioRun({send,evaluate,until,click,rootUrl,mobile}) {
 const app='window.centerApp',results=[],failures=[];
 const width=mobile?390:1280,height=mobile?844:900;
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
 await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
 async function open(){
  await send('Page.navigate',{url:rootUrl});await until(`document.body.dataset.ready==='true'`);
  await evaluate(`import('./app.mjs').then(m=>{window.centerApp=m.app;return true;})`);
  // Capture on either side of the actual click handler, within the same event.
  // This avoids confusing normal playback progress with a navigation mutation.
  await evaluate(`(()=>{window.centerTouches=0;window.centerContact=[];for(const type of ['pointerdown','pointerup','touchstart','touchend'])document.addEventListener(type,e=>{if(e.target.closest('#plane-focus')){const b=document.getElementById('plane-focus'),r=b.getBoundingClientRect();window.centerContact.push({type,target:e.target.localName,rect:[r.x,r.y,r.width,r.height],time:e.timeStamp,scale:visualViewport.scale,offset:visualViewport.offsetTop,prevented:e.defaultPrevented});}},{capture:false,passive:true});document.addEventListener('touchstart',e=>{if(e.target.closest('#plane-focus'))window.centerTouches++;},{capture:true,passive:true});document.addEventListener('pointerdown',e=>{if(e.target.closest('#plane-focus')){window.centerPointer=e.pointerType;window.centerPrimary=e.isPrimary;}},true);const a=${app},snapshot=()=>JSON.stringify({save:a.controller.session.save(),selected:a.controller.selectedId,choice:a.controller.choice,forecast:a.controller.activeForecast,tracks:a.controller.tracks,playing:a.controller.playing,rate:a.controller.rate});document.addEventListener('click',e=>{if(e.target.closest('#plane-focus'))window.centerBefore=snapshot();},true);document.addEventListener('click',e=>{if(e.target.closest('#plane-focus')){window.centerAfter=snapshot();window.centerClicks=(window.centerClicks??0)+1;}});})()`);
 }
 async function check(name,run){try{await run();results.push(name);if(process.env.CENTER_TRACE)console.log('PASS',mobile,name);}catch(error){failures.push(`${name}: ${error.message}`);if(process.env.CENTER_TRACE)console.log('FAIL',mobile,name,error.message);}}
 async function key(key,code,keyCode){await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,...(key==='Enter'?{text:'\r'}:key===' '?{text:' '}:{} )});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode});}
 async function hide(zoom){
  await evaluate(`(()=>{const a=${app},p=a.controller.view.state.position;a.globe.focus({latitudeDeg:-p.latitudeDeg,longitudeDeg:((p.longitudeDeg+360)%360+360)%360-180},${zoom});a.render();})()`);
  assert.equal(await evaluate(`${app}.globe.planePose.visible`),false,'Setup must put the plane behind the globe');
 }
 async function centered(zoom){
  await until(`${app}.globe.dirty===false`);
  const r=await evaluate(`(()=>{const a=${app},g=a.globe,p=a.controller.view.state.position;return {camera:g.camera,position:p,pose:g.planePose,cx:g.frame.cx,cy:g.frame.cy,audit:window.centerBefore===window.centerAfter};})()`);
  assert.equal(r.audit,true,'Navigation changed selection, accepted route, resources, UTC or playback');
  assert.equal(r.camera.zoom,zoom,'Centering must preserve the selected zoom');
  assert.ok(Math.abs(r.camera.latitudeDeg-r.position.latitudeDeg)<1e-9,`Wrong latitude: ${JSON.stringify(r)}`);
  assert.ok(Math.abs(r.camera.longitudeDeg-r.position.longitudeDeg)<1e-9,'Wrong longitude');
  assert.equal(r.pose.visible,true);assert.ok(Math.abs(r.pose.x-r.cx)<1e-7);assert.ok(Math.abs(r.pose.y-(r.cy-13))<1e-7);
  assert.equal(await evaluate(`(()=>{const g=${app}.globe,c=g.canvas.getBoundingClientRect(),p=g.planePose,overlap=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,controls=[...document.querySelectorAll('.map-controls button,#plane-focus,.playback,#goal-focus')].filter(e=>!e.hidden&&e.getBoundingClientRect().width).map(e=>e.getBoundingClientRect()),plane={left:c.left+p.x-18,right:c.left+p.x+18,top:c.top+p.y-18,bottom:c.top+p.y+18},row=g.markerLayout.rows.find(r=>r.id===${app}.controller.selectedId);return !controls.some(r=>overlap(r,plane))&&(!row||![{left:row.x-22,right:row.x+22,top:row.y-22,bottom:row.y+22},row.label].filter(Boolean).some(r=>controls.some(o=>overlap(o,{left:r.left+c.left,right:r.right+c.left,top:r.top+c.top,bottom:r.bottom+c.top}))));})()`),true,'Controls cover the plane or selected airport');
 }
 async function activate(){
  const before=await evaluate('window.centerClicks??0'),touches=await evaluate('window.centerTouches');
  if(mobile){
   const point=await evaluate(`(()=>{const r=document.getElementById('plane-focus').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:0};})()`);
   await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
   // Wait for delivery and a rendered frame before releasing the contact.
   await until(`window.centerTouches>${touches}`);
   await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
   await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else await click('#plane-focus',false);
  try{await until(`(window.centerClicks??0)>${before}`);}catch(error){throw Error(error.message+' '+JSON.stringify(await evaluate(`({primary:window.centerPrimary,pointer:window.centerPointer,touches:window.centerTouches,focus:document.hasFocus(),scrollY,disabled:document.getElementById('plane-focus').disabled,contacts:window.centerContact})`)));}
  assert.equal(await evaluate('window.centerPointer'),mobile?'touch':'mouse');assert.equal(await evaluate('window.centerPrimary'),true);
  if(mobile)assert.equal(await evaluate('window.centerTouches'),touches+1);
 }
 async function center(zoom){await hide(zoom);await activate();await centered(zoom);}
 async function screenshot(label){const viewportWidth=await evaluate('innerWidth');const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await mkdir('.build/previews',{recursive:true});await writeFile(`.build/previews/center-${label}-${viewportWidth}.png`,Buffer.from(shot.data,'base64'));}
 await open();await until(`${app}.planner.summary().complete`);
 await check('discoverable single SVG control with a 44 px target',async()=>{
  const r=await evaluate(`(()=>{const b=document.getElementById('plane-focus'),r=b.getBoundingClientRect();return {text:b.textContent.trim(),label:b.getAttribute('aria-label'),title:b.title,svg:!!b.querySelector('svg path'),width:r.width,height:r.height,count:document.querySelectorAll('#plane-focus').length,visible:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};})()`);
  assert.match(r.text,/Центрировать/);assert.match(r.label,/Центрировать.*самол/);assert.ok(r.title);assert.equal(r.svg,true);assert.equal(r.count,1);assert.ok(r.width>=44&&r.height>=44);assert.equal(r.visible,true);
 });
 await evaluate(`${app}.select('BIKF')`);
 await check('planning centers the current airport and preserves all zooms and selection',async()=>{for(const zoom of [.75,1,1.5,3,5])await center(zoom);await screenshot('planning');});
 await check('keyboard Tab, Enter and Space activate the same control',async()=>{
  for(const [k,c,n] of [['Enter','Enter',13],[' ','Space',32]]){
   await hide(3);await evaluate(`document.getElementById('zoom-out').focus()`);await key('Tab','Tab',9);
   assert.equal(await evaluate(`document.activeElement.id`),'plane-focus');
   assert.equal(await evaluate(`document.activeElement.matches(':focus-visible')`),true);
   await key(k,c,n);await centered(3);
  }
 });
 await click('#fly',mobile);await click('#play-pause',mobile);
 await evaluate(`(()=>{const a=${app},r=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route;a.advanceTo((r.startUtcMs+r.endUtcMs)/2);})()`);
 await check('paused cruise centers the actual UTC without starting time',async()=>{
  const before=await evaluate(`${app}.controller.session.save()`);await center(5);
  await evaluate('new Promise(r=>setTimeout(r,100))');assert.equal(await evaluate(`${app}.controller.session.save()`),before);assert.equal(await evaluate(`${app}.controller.playing`),false);await screenshot('paused');
 });
 await check('centering on pause restores following after resume',async()=>{
  await center(1);await click('#play-pause',mobile);
  await until(`Math.abs(${app}.globe.camera.longitudeDeg-${app}.controller.view.state.position.longitudeDeg)<1e-9 && ${app}.controller.view.state.utcMs>${app}.controller.anchorUtc`);
  await click('#play-pause',mobile);
 });
 // Isolate gesture input from the preceding keyboard/playback scenarios.
 await open();
 await evaluate(`(()=>{const a=${app};a.controller.select('BIKF');a.controller.fly(0);a.controller.pause(0);const r=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route;a.advanceTo((r.startUtcMs+r.endUtcMs)/2);})()`);
 await check('centering during playback restores following',async()=>{
  await hide(3);await evaluate(`${app}.controller.play();${app}.render()`);await activate();await centered(3);
  await until(`${app}.controller.view.state.utcMs>${app}.controller.anchorUtc`);
 });
 // Give drag -> center its own input history, independent of the previous tap.
 await open();await evaluate(`${app}.select('BIKF')`);await click('#fly',mobile);await click('#play-pause',mobile);
 await evaluate(`(()=>{const a=${app},r=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route;a.advanceTo((r.startUtcMs+r.endUtcMs)/2);})()`);
 await click('#play-pause',mobile);
 await check('manual mouse/touch rotation releases following and the button restores it',async()=>{
  await evaluate(`${app}.globe.zoom(3);${app}.render()`);
  const b=await evaluate(`(()=>{const r=${app}.globe.canvas.getBoundingClientRect();return {x:r.x+r.width*.55,y:r.y+r.height*.45};})()`);
  if(mobile){
   await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...b,id:0}]});
   for(let step=1;step<=5;step++){await evaluate('new Promise(r=>setTimeout(r,40))');await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+70*step/5,y:b.y+12*step/5,id:0}]});}
   await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...b});await send('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:b.x+70,y:b.y+12});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:b.x+70,y:b.y+12});}
  const camera=await evaluate(`JSON.stringify(${app}.globe.camera)`),utc=await evaluate(`${app}.controller.view.state.utcMs`);
  await until(`${app}.controller.view.state.utcMs>${utc}`);
  await until(`${app}.globe.pointers.size===0`);
  await evaluate('new Promise(r=>setTimeout(r,250))');assert.equal(await evaluate(`JSON.stringify(${app}.globe.camera)`),camera);
  await activate();await centered(3);await click('#play-pause',mobile);
 });
 await evaluate(`${app}.controller.pause();${app}.advanceTo(${app}.controller.session.endUtcMs);${app}.select('CYEG')`);await click('#fly',mobile);await click('#play-pause',mobile);
 await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs);${app}.select('UHMA')`);await click('#fly',mobile);await click('#play-pause',mobile);
 await check('real westward flight centers on both sides of the date line',async()=>{
  const longitudes=[];for(const fraction of [.8,.99]){await evaluate(`(()=>{const a=${app},r=a.controller.activeForecast.phases.find(p=>p.label==='cruise').route;a.advanceTo(r.startUtcMs+(r.endUtcMs-r.startUtcMs)*${fraction});})()`);longitudes.push(await evaluate(`${app}.controller.view.state.position.longitudeDeg`));await center(3);}
  assert.ok(longitudes[0]<0&&longitudes[1]>0,'Fixture must visit both sides of the date line');
 });
 // Small-phone layout, with the real accepted flight still paused.
 if(mobile)await check('320 px phone keeps control and aircraft clear of playback',async()=>{await send('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});await center(5);await screenshot('narrow');assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);});
 const fixture=structuredClone(await loadCycleDefinition());
 fixture.scenarioId='synthetic-center-polar';fixture.airports=fixture.airports.filter(a=>['ULLI','BIKF','UNNT'].includes(a.id));
 for(const [i,a] of fixture.airports.entries()){a.latitudeDeg=89.5;a.longitudeDeg=[179.9,-179.9,90][i];}
 fixture.initial.utcMs=Date.parse('2026-01-01T00:00:00Z');
 fixture.initial.stocks=Object.fromEntries(fixture.airports.map(a=>[a.id,64000]));
 const script=(await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch.bind(window);window.fetch=(input,...args)=>String(input).endsWith('/data/runtime/mission.json')?Promise.resolve(new Response(${JSON.stringify(JSON.stringify(fixture))})):original(input,...args);})()`})).identifier;
 try{await open();await check('synthetic near-pole planning uses the same camera projection',async()=>{for(const z of [.75,5])await center(z);await screenshot('polar');});}
 finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script});}
 assert.deepEqual(failures,[],'Centering acceptance failures');
 return {viewport:mobile?'390/320 touch':'1280 mouse',passed:true,steps:results};
}
