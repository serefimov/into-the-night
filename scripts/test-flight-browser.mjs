// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
export async function flightScenarioRun({send,evaluate,until,click,rootUrl,mobile}) {
 await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
 await send('Page.navigate',{url:rootUrl});await until(`location.pathname.endsWith('/web/flight/index.html') && document.body.dataset.ready==='true'`);
 await evaluate(`import('./app.mjs').then(module=>{window.flightModule=module;return true;})`);
 const app='window.flightModule.app';
 const snapshot=()=>evaluate(`${app}.controller.session.save()`);
 const initial=await snapshot();assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 assert.equal(await evaluate(`document.querySelectorAll('input,select,dialog').length`),0);
 assert.equal(await evaluate(`document.getElementById('fly').disabled`),true);
 await until(`${app}.globe.data.statuses.has('NZCH') && ${app}.globe.data.statuses.has('FACT')`);
 assert.equal(await evaluate(`${app}.globe.data.statuses.get('NZCH').allowed`),true);assert.equal(await evaluate(`${app}.globe.data.statuses.get('FACT').allowed`),false);
 async function inspectLayout(name){
  const result=await evaluate(`(()=>{const g=${app}.globe,r=g.markerLayout;return {count:r.rows.length,budget:r.budget,projected:r.projectedCount,members:r.rows.flatMap(p=>p.group.map(a=>a.id)),labelCount:r.rows.filter(p=>p.label&&!p.priority).length,detail:r.detail,targets:r.rows.filter(p=>p.priority).map(p=>p.id),hitSizes:[...g.nodes.values()].map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height}))};})()`);
  assert.ok(result.count<=result.budget,name);assert.equal(new Set(result.members).size,result.members.length);assert.equal(result.members.length,result.projected,name);assert.ok(result.hitSizes.every(s=>s.w>=43.99&&s.h>=43.99),JSON.stringify(result.hitSizes));if(!result.detail)assert.equal(result.labelCount,0);return result;
 }
 const overview=await inspectLayout('initial overview');assert.ok(overview.count<=24);
 await until(`${app}.globe.data.statuses.size===${app}.controller.session.definition.airports.length`);
 const catalogCount=await evaluate(`${app}.globe.data.statuses.size`);assert.equal(catalogCount,1183);assert.ok(catalogCount>overview.count);
 for(const zoom of [1,5,1]){await evaluate(`${app}.globe.focus({latitudeDeg:50,longitudeDeg:10},${zoom});${app}.render()`);await inspectLayout('dense Europe '+zoom);assert.equal(await snapshot(),initial);}
 await evaluate(`${app}.globe.focus({latitudeDeg:-42,longitudeDeg:-140},1);${app}.render()`);
 const land=await evaluate(`(()=>{const g=${app}.globe;const at=(lat,lon)=>g.landPixels[(Math.floor((90-lat)/180*512)*1024+Math.floor((lon+180)/360*1024))*4+3]>90;return [at(-25,134),at(20,15),at(-88,0),at(0,-140)];})()`);
 assert.deepEqual(land,[true,true,true,false],'Coastline texture must contain real continents and ocean');
 const bounds=await evaluate(`(()=>{const r=document.getElementById('globe').getBoundingClientRect();return {x:r.x+r.width*.35,y:r.y+r.height*.6};})()`);
 if(mobile){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...bounds,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:bounds.x+65,y:bounds.y+15,id:1}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...bounds});await send('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,x:bounds.x+65,y:bounds.y+15});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:bounds.x+65,y:bounds.y+15});}
 assert.equal(await evaluate(`${app}.controller.selectedId`),null,'Dragging must not select a marker');assert.equal(await snapshot(),initial);
 const zoom=await evaluate(`${app}.globe.camera.zoom`);
 if(mobile){const p=[{x:bounds.x-30,y:bounds.y,id:1},{x:bounds.x+30,y:bounds.y,id:2}];await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:p});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p[0],x:bounds.x-60},{...p[1],x:bounds.x+60}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:bounds.x,y:bounds.y,deltaY:-200,deltaX:0});
 await until(`${app}.globe.camera.zoom>${zoom}`);assert.equal(await snapshot(),initial);
 async function select(id) {
  await evaluate(`(()=>{const a=${app};a.globe.focus(a.controller.session.definition.airports.find(p=>p.id===${JSON.stringify(id)}),5);a.render();})()`);
  const hit=await evaluate(`(()=>{const a=${app},h=a.globe.hits.find(h=>h.id===${JSON.stringify(id)}||h.group?.some(p=>p.id===${JSON.stringify(id)})),r=document.getElementById('globe').getBoundingClientRect();if(!h)throw Error('Marker not found');return {x:r.x+h.x,y:r.y+h.y,cluster:!!h.cluster};})()`);
  if(mobile){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hit.x,y:hit.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:hit.x,y:hit.y});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:hit.x,y:hit.y});}
  if(hit.cluster)await click(`.cluster-picker [data-airport-id="${id}"]`,mobile);
  await until(`${app}.controller.selectedId===${JSON.stringify(id)}`);
 }
 await select('FACT');assert.equal(await evaluate(`document.getElementById('fly').disabled`),true);assert.match(await evaluate(`document.getElementById('verdict-detail').textContent`),/Солнце/);assert.equal(await snapshot(),initial);
 await select('NZCH');assert.equal(await evaluate(`document.getElementById('fly').disabled`),false);assert.equal(await snapshot(),initial);
 assert.match(await evaluate(`document.getElementById('stock-value').textContent`),/64/);assert.match(await evaluate(`document.getElementById('verdict-title').textContent`),/Весь переход безопасен/);
 assert.match(await evaluate(`document.getElementById('dispatch-summary').textContent`),/37,6 т/);assert.equal(await evaluate(`document.getElementById('dispatch-summary').getBoundingClientRect().height>0`),true);
 await evaluate(`${app}.globe.focus({latitudeDeg:-42,longitudeDeg:-140},1);${app}.render()`);
 await inspectLayout('selected overview');
 assert.equal(await evaluate(`['SCEL','NZCH'].every(id=>{const n=${app}.globe.nodes.get(id)?.querySelector('.marker-label');return n&&!n.hidden&&n.scrollWidth<=n.clientWidth;})`),true,'Current and selected names must fit without ellipsis');
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await mkdir('.build/previews',{recursive:true});await writeFile(`.build/previews/flight-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));
 if(process.env.GLOBE_PREVIEW_LOG==='1')console.log(`GLOBE_PREVIEW_${mobile?'MOBILE':'DESKTOP'} ${shot.data}`);
 await evaluate(`${app}.globe.focus({latitudeDeg:50,longitudeDeg:10},1);${app}.render()`);
 const dense=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`.build/previews/flight-dense-${mobile?'mobile':'desktop'}.png`,Buffer.from(dense.data,'base64'));
 if(process.env.GLOBE_PREVIEW_LOG==='1')console.log(`GLOBE_DENSE_${mobile?'MOBILE':'DESKTOP'} ${dense.data}`);
 await evaluate(`${app}.globe.focus({latitudeDeg:-42,longitudeDeg:-140},1);${app}.render()`);
 assert.equal(await snapshot(),initial);
 await click('#fly',mobile);await until(`${app}.controller.playing`);await click('#play-pause',mobile);await until(`!${app}.controller.playing`);
 const paused=await snapshot();await evaluate('new Promise(r=>setTimeout(r,80))');assert.equal(await snapshot(),paused,'Paused animation must not advance');
 assert.equal(await evaluate(`document.getElementById('flight-clock').dateTime===new Date(${app}.controller.view.state.utcMs).toISOString() && ${app}.globe.lastUtcMs===${app}.controller.view.state.utcMs`),true);
 await click('#play-pause',mobile);await until(`${app}.controller.playing`);await click('#play-pause',mobile);
 await evaluate(`(()=>{const a=${app},p=a.controller.activeForecast.phases.find(p=>p.label==='refuelling').route;a.advanceTo(p.startUtcMs+300000+1200000);})()`);
 assert.match(await evaluate(`document.getElementById('flight-status').textContent`),/Дозаправка перед вылетом/);assert.equal(await evaluate(`${app}.controller.view.state.stocks.SCEL`),84000);
 assert.equal(await evaluate(`${app}.controller.view.state.status`),'running');assert.equal(await evaluate(`document.getElementById('fly').disabled`),true);
 await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);await until(`${app}.controller.view.state.phase==='planning'`);assert.equal(await evaluate(`${app}.controller.view.state.stocks.NZCH`),64000);
 await select('YPPH');await click('#fly',mobile);await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
 await select('FACT');await click('#fly',mobile);await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
 assert.equal(await evaluate(`${app}.controller.view.state.status`),'won');assert.match(await evaluate(`document.getElementById('verdict-title').textContent`),/Цель достигнута/);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 return {viewport:mobile?'390x844 touch':'1280x900 mouse',passed:true,steps:['viewport marker budget','all-catalog worker independent of visibility','dense region zoom and touch targets','real land texture','worker forecasts','drag/pinch/wheel without mutation','map marker selection','blocked eastern direct route','single flight confirmation','pause/resume','one displayed UTC','partial automatic refuelling','full western route','no numeric forms or overflow']};
}
