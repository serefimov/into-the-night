// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

export async function inspectAirportDetail({app,send,evaluate,until,click,mobile}){
 const original=await evaluate(`({camera:{...${app}.globe.camera},selected:${app}.controller.selectedId,save:${app}.controller.session.save()})`);
 async function focus(id,zoom){await evaluate(`(()=>{const a=${app};a.globe.focus(a.controller.session.definition.airports.find(p=>p.id===${JSON.stringify(id)}),${zoom});a.render();})()`);}
 async function tapMember(id){
  const point=await evaluate(`(()=>{const g=${app}.globe,h=g.hits.find(h=>h.group.some(p=>p.id===${JSON.stringify(id)})),r=g.canvas.getBoundingClientRect();if(!h)throw Error('Missing airport');return {x:r.x+h.x,y:r.y+h.y};})()`);
  if(mobile){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});}
  await until(`!${app}.globe.dirty`);
 }
 try{
  const startZoom=await evaluate(`(()=>{const r=${app}.globe.canvas.getBoundingClientRect();return 17000/(Math.min(r.width,r.height)*.44);})()`);
  await focus('LRBS',startZoom);
  assert.equal(await evaluate(`${app}.globe.hits.some(h=>h.cluster&&h.group.some(p=>p.id==='LRBS')&&h.group.some(p=>p.id==='LROP'))`),true);
  await tapMember('LRBS');
  assert.ok(Math.abs(await evaluate(`${app}.globe.camera.zoom`)-startZoom*3)<1e-8);
  assert.equal(await evaluate(`${app}.globe.picker.hidden`),true,'A normal cluster must zoom, not force a list');
  assert.equal(await evaluate(`['LRBS','LROP'].every(id=>${app}.globe.hits.some(h=>h.id===id&&!h.cluster))`),true);
  assert.equal(await evaluate(`${app}.controller.session.save()`),original.save);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await mkdir('.build/previews',{recursive:true});
  await writeFile(`.build/previews/airport-detail-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));
  await tapMember('LRBS');
  assert.equal(await evaluate(`${app}.controller.selectedId`),'LRBS');
  const before=await evaluate(`${app}.globe.camera.longitudeDeg`);
  await evaluate(`${app}.globe.canvas.focus()`);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  const delta=await evaluate(`${app}.globe.camera.longitudeDeg`)-before;
  assert.ok(delta>0&&delta<.1,'Deep zoom keyboard pan must remain local');
  await evaluate(`${app}.globe.zoom(1e6);${app}.render()`);
  assert.equal(await evaluate(`${app}.globe.camera.zoom`),512);
  await click('#plane-focus',mobile);
  await until(`!${app}.globe.dirty`);
  assert.equal(await evaluate(`${app}.globe.camera.zoom`),512);
  assert.equal(await evaluate(`Math.abs(${app}.globe.camera.latitudeDeg-${app}.controller.view.state.position.latitudeDeg)<1e-9`),true);
  await focus('CYEG',512);await tapMember('CYEG');
  assert.equal(await evaluate(`${app}.globe.picker.hidden`),false,'Near-identical source records still need a choice');
  await click('.cluster-picker [data-airport-id="CYEG"]',mobile);
  assert.equal(await evaluate(`${app}.controller.selectedId`),'CYEG');
  assert.equal(await evaluate(`${app}.controller.session.save()`),original.save);
 }finally{
  await evaluate(`${app}.select(${JSON.stringify(original.selected)});${app}.globe.focus(${JSON.stringify(original.camera)},${original.camera.zoom});${app}.render()`);
 }
}
