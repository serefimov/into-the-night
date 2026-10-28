// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {openFlightPage} from './browser-navigation.mjs';

export async function windowScenarioRun({send,evaluate,until,click,rootUrl,mobile}){
 const app='window.windowApp',directory=await mkdtemp(`${tmpdir()}/departure-window-`);
 const save=()=>evaluate(`${app}.controller.session.save()`);
 async function open(preserveSave=false){
  await openFlightPage({send,evaluate,until,rootUrl,preserveSave});
  await evaluate(`import('./app.mjs').then(m=>{window.windowApp=m.app;return true;})`);
 }
 async function menu(selector){
  if(!await evaluate(`document.getElementById('session-menu').open`))await click('#session-menu summary',mobile);
  await click(selector,mobile);
 }
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});
  await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
  await open();
  const original=await save(),initial=await evaluate(`${app}.controller.view.state`);
  await evaluate(`${app}.select('KMCI')`);
  await until(`${app}.planner.statuses.get('KMCI')?.window?.status==='waiting'`);
  assert.equal(await save(),original,'Searching a window must be free planning');
  assert.equal(await evaluate(`document.getElementById('wait-departure').hidden`),false);
  assert.equal(await evaluate(`document.getElementById('fly').disabled`),true);
  assert.match(await evaluate(`document.getElementById('window-detail').textContent`),/начало перехода.*вылет.*прибытие/);
  await evaluate(`(()=>{const a=${app},airport=a.controller.session.definition.airports.find(p=>p.id==='KMCI');a.globe.focus(airport,3);a.render();})()`);
  assert.match(await evaluate(`${app}.globe.nodes.get('KMCI').textContent`),/◷/);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await mkdir('.build/previews',{recursive:true});
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(`.build/previews/departure-window-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));
  await click('#wait-departure',mobile);await click('#play-pause',mobile);
  await evaluate(`${app}.advanceTo(${initial.utcMs}+300000)`);
  assert.equal(await evaluate(`${app}.controller.view.state.phase`),'waiting');
  await menu('#save-mission');
  const paused=await save();
  await evaluate(`HTMLAnchorElement.prototype.click=function(){window.windowExport=fetch(this.href).then(r=>r.text());}`);
  await menu('#export-mission');
  const exported=await evaluate('window.windowExport');assert.equal(exported,paused);
  const path=directory+'/waiting.json';await writeFile(path,exported);
  const cli=spawnSync(process.execPath,['scripts/mission-cycle-cli.mjs','--load',path],{encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).state.phase,'waiting');
  await open(true);
  assert.equal(await save(),paused);assert.equal(await evaluate(`${app}.controller.selectedId`),'KMCI');
  assert.equal(await evaluate(`${app}.controller.playing`),false);
  if(mobile){
   await send('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});
   await evaluate(`${app}.globe.focus(${app}.controller.view.state.position,1);${app}.render()`);
   assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
   const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
   await writeFile('.build/previews/departure-wait-320.png',Buffer.from(shot.data,'base64'));
  }
  await click('#stop-wait',mobile);
  if(mobile)await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate(`${app}.controller.view.state.utcMs`),initial.utcMs+300000);
  assert.equal(await evaluate(`${app}.controller.view.state.phase`),'planning');
  assert.equal(await evaluate(`${app}.controller.choice.allowed`),true,'Cancellation recomputes the immediate forecast at the actual UTC');
  await open();await evaluate(`${app}.select('KMCI')`);
  await until(`${app}.planner.statuses.get('KMCI')?.window?.status==='waiting'`);
  await click('#wait-departure',mobile);await click('#play-pause',mobile);
  await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  const ready=await evaluate(`${app}.controller.view.state`);
  assert.equal(ready.phase,'planning');assert.equal(ready.flights,0);assert.equal(ready.fuelKg,initial.fuelKg);assert.deepEqual(ready.stocks,initial.stocks);
  assert.equal(await evaluate(`${app}.controller.playing`),false);
  assert.equal(await evaluate(`document.getElementById('fly').disabled`),false);
  await click('#fly',mobile);await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  assert.equal(await evaluate(`${app}.controller.view.state.airportId`),'KMCI');
  assert.equal(await evaluate(`${app}.controller.view.state.flights`),1);
  return {viewport:mobile?'390 touch':'1280 desktop',passed:true,steps:['free full-core window search','clock marker and card UTCs','explicit wait and separate launch','pause/reload/export to CLI','stop and recalculate','stocks conserved until flight']};
 }finally{await rm(directory,{recursive:true,force:true});}
}
