// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openFlightPage} from './browser-navigation.mjs';

export async function aircraftTransferScenarioRun({send,evaluate,until,click,rootUrl,mobile}){
 const app='window.transferApp';
 const state=()=>evaluate(`${app}.controller.view.state`);
 const save=()=>evaluate(`${app}.controller.session.save()`);
 async function open(preserveSave=false){
  await openFlightPage({send,evaluate,until,rootUrl,preserveSave,scenario:'aircraft-transfer'});
  await evaluate("import('./app.mjs').then(m=>{window.transferApp=m.app;return true;})");
 }
 async function complete(){await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);}
 async function fly(destination){
  await evaluate(`${app}.select(${JSON.stringify(destination)})`);
  await click('#fly',mobile);
  await complete();
  assert.equal((await state()).airportId,destination);
 }
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});
  await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
  await open();
  assert.match(await evaluate("document.getElementById('active-aircraft').textContent"),/Boeing 787/);
  await evaluate(`${app}.select('RORH')`);
  assert.equal(await evaluate("document.getElementById('fly').disabled"),true);
  assert.match(await evaluate("document.getElementById('verdict-detail').textContent"),/Пригодность полосы/);
  await click('[data-aircraft-id="twin-otter"]',mobile);
  await click('#play-pause',mobile);
  await evaluate(`${app}.advanceTo(${app}.controller.view.state.activeTransfer.startUtcMs+300000)`);
  assert.equal((await state()).phase,'transferring');
  assert.equal((await state()).fleet.activeId,'dreamliner');
  const paused=await save();
  await open(true);
  assert.equal(await save(),paused);
  assert.equal(await evaluate(`${app}.controller.playing`),false);
  await complete();
  assert.match(await evaluate("document.getElementById('active-aircraft').textContent"),/Twin Otter/);
  assert.match(await evaluate("document.getElementById('flight-fuel').textContent"),/260 кг/);
  await until(`${app}.globe.data.statuses.get('RORH')?.allowed===true`);
  await fly('RORH');
  assert.match(await evaluate("document.getElementById('parked-aircraft').textContent"),/Boeing 787.*Наха/s);
  assert.equal(await evaluate("document.querySelector('#parked-aircraft button')===null"),true);
  await evaluate(`${app}.controller.waitUntil(${app}.controller.session.currentTimeUtc+3600000)`);
  await complete();
  await fly('ROAH');
  if(mobile){
   await send('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});
   await evaluate(`${app}.render()`);
  }
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
  await evaluate("document.getElementById('fleet-panel').scrollIntoView({block:'center'})");
  const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await mkdir('.build/previews',{recursive:true});
  await writeFile(`.build/previews/aircraft-transfer-${mobile?'mobile':'desktop'}.png`,Buffer.from(result.data,'base64'));
  await click('[data-aircraft-id="dreamliner"]',mobile);
  await complete();
  const after=await state();
  assert.equal(after.fleet.activeId,'dreamliner');
  assert.equal(after.fuelKg,5000);
  assert.ok(Math.abs(after.fleet.parked[0].fuelKg-150)<1e-9);
  await fly('ZGGG');
  assert.equal((await state()).status,'won');
  return {viewport:mobile?'390/320 touch':'1280 desktop',passed:true,steps:['profile-specific runway','transfer pause and reload','worker uses the new profile','no remote transfer','island circuit','preserved parked fuel','onward jet flight']};
 }finally{
  await evaluate(`${app}?.destroy()`);
 }
}
