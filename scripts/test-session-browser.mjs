// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {openFlightPage} from './browser-navigation.mjs';

export async function sessionScenarioRun({send, evaluate, until, click, rootUrl, mobile}) {
 const directory = await mkdtemp(`${tmpdir()}/mission-session-`);
 const app = 'window.sessionApp';
 const snapshot = () => evaluate(`${app}.controller.session.save()`);
 const state = () => evaluate(`${app}.controller.view.state`);

 async function open(preserveSave = false) {
  await openFlightPage({send, evaluate, until, rootUrl, preserveSave});
  await evaluate(`import('./app.mjs').then(m=>{window.sessionApp=m.app;return true;})`);
 }

 async function menuClick(selector) {
  if (!await evaluate(`document.getElementById('session-menu').open`)) {
   await click('#session-menu summary', mobile);
  }
  await click(selector, mobile);
 }

 async function flyTo(destination) {
  await evaluate(`${app}.select(${JSON.stringify(destination)})`);
  await click('#fly', mobile);
  await click('#play-pause', mobile);
 }

 async function advanceWithin(phase) {
  await evaluate(`(()=>{
   const a=${app},p=a.controller.activeForecast.phases.find(p=>p.label===${JSON.stringify(phase)}).route;
   a.controller.advanceTo((p.startUtcMs+p.endUtcMs)/2);
   a.render();
  })()`);
 }

 async function exportJournal(label) {
  await evaluate(`window.exportedMission=null;HTMLAnchorElement.prototype.click=function(){window.exportedMission=fetch(this.href).then(r=>r.text());}`);
  await menuClick('#export-mission');
  const serialized = await evaluate('window.exportedMission');
  assert.equal(typeof serialized, 'string');
  const path = `${directory}/${label}.json`;
  await writeFile(path, serialized);
  const replay = spawnSync(process.execPath, ['scripts/mission-cycle-cli.mjs', '--load', path], {encoding:'utf8'});
  assert.equal(replay.status, 0, replay.stderr);
  const actual = JSON.parse(replay.stdout).state;
  const expected = await state();
  for (const key of ['utcMs', 'fuelKg', 'flights', 'distanceKm', 'phase', 'status', 'result']) {
   if (key === 'fuelKg' || key === 'distanceKm') {
    assert.ok(Math.abs(actual[key]-expected[key])<=1e-9, `CLI replay differs: ${key}`);
   } else assert.deepEqual(actual[key], expected[key], `CLI replay differs: ${key}`);
  }
  return {serialized, path};
 }

 async function importFile(path) {
  await evaluate(`document.getElementById('session-message').textContent=''`);
  const {root} = await send('DOM.getDocument');
  const {nodeId} = await send('DOM.querySelector', {nodeId:root.nodeId, selector:'#import-mission'});
  await send('DOM.setFileInputFiles', {nodeId, files:[path]});
 }

 try {
  await send('Emulation.setDeviceMetricsOverride', {width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});
  await send('Emulation.setTouchEmulationEnabled', {enabled:mobile});
  await open();
  assert.equal(await evaluate(`document.querySelectorAll('#session-menu').length`), 1);
  assert.equal(await evaluate(`document.getElementById('session-menu').open`), false);
  assert.equal(await evaluate(`document.querySelectorAll('input:not([type="file"]),select').length`), 0);
  await evaluate(`document.querySelector('#session-menu summary').focus()`);
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  assert.equal(await evaluate(`document.getElementById('session-menu').open`), true);
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('#session-menu summary').getBoundingClientRect();return r.width>=44&&r.height>=44;})()`), true);
  await send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await send('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert.equal(await evaluate(`document.getElementById('session-menu').open`), false);

  await flyTo('BIKF');
  await advanceWithin('cruise');
  const cruise = await snapshot();
  await menuClick('#save-mission');
  const exported = await exportJournal('cruise');
  assert.equal(exported.serialized, cruise);
  await evaluate(`${app}.controller.advanceTo(${app}.controller.view.state.utcMs+1000);${app}.render()`);
  await menuClick('#restore-mission');
  assert.equal(await snapshot(), cruise, 'Local restore must replace the current progress with its checkpoint');
  await open(true);
  assert.equal(await snapshot(), cruise, 'Reload must restore the saved UTC');
  assert.equal(await evaluate(`${app}.controller.playing`), false);
  assert.equal(await evaluate(`${app}.controller.selectedId`), 'BIKF');
  assert.equal(await evaluate(`${app}.globe.planePose.visible`), true);
  assert.equal(await evaluate(`${app}.controller.tracks.length`), 1);
  await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  assert.equal(await snapshot(), cruise, 'A restored party must remain paused');

  // Invalid file loads must leave even the current playback intention intact.
  for (const [name, contents] of [
   ['damaged', '{'],
   ['old', '{"format":"into-the-night-mission","version":2}'],
  ]) {
   const path = `${directory}/${name}.json`;
   await writeFile(path, contents);
   await evaluate(`document.getElementById('session-message').textContent=''`);
   await importFile(path);
   await until(`document.getElementById('session-message').textContent.includes('Не удалось')`);
   assert.equal(await snapshot(), cruise);
  }

  await click('#play-pause', mobile);
  await until(`JSON.parse(localStorage.getItem('into-the-night-flight-v3')).payload.cursorUtcMs>${JSON.parse(cruise).payload.cursorUtcMs}`);
  assert.equal(await evaluate(`${app}.globe.camera.longitudeDeg===${app}.controller.view.state.position.longitudeDeg`), true,
   'Resuming a restored flight must follow the aircraft');
  await click('#play-pause', mobile);

  await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  await flyTo('CYEG');
  await advanceWithin('refuelling');
  const pumping = await snapshot();
  assert.ok((await state()).stocks.BIKF < 64000);
  await exportJournal('refuelling');
  // pagehide checkpoints the shown state even without pressing Save.
  await open(true);
  assert.equal(await snapshot(), pumping, 'Reload during pumping must not refill the warehouse');
  assert.equal((await state()).phase, 'refuelling');
  await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  const completed = await state();

  await importFile(exported.path);
  await until(`document.getElementById('session-message').textContent.includes('восстановлена')`);
  assert.equal(await snapshot(), cruise);
  await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  await flyTo('CYEG');
  await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  assert.deepEqual(await state(), completed, 'File restore and continuation must not duplicate refuelling');

  // Storage failure is recoverable; journal export still works.
  const beforeFailure = await snapshot();
  await evaluate(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');}`);
  await menuClick('#save-mission');
  assert.match(await evaluate(`document.getElementById('session-message').textContent`), /Не удалось/);
  assert.equal(await snapshot(), beforeFailure);
  await exportJournal('storage-unavailable');
  await evaluate('Storage.prototype.setItem=window.originalSetItem');
  await click('#session-menu summary', mobile);

  for (const destination of ['UHMA', 'UNNT']) {
   await flyTo(destination);
   await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  }
  assert.equal((await state()).status, 'won');
  assert.equal(await evaluate(`document.getElementById('mission-summary').hidden`), false);
  assert.equal(await evaluate(`document.querySelectorAll('#summary-route li').length`), 5);
  assert.match(await evaluate(`document.getElementById('summary-goal').textContent`), /Новосибирск/);
  assert.match(await evaluate(`document.getElementById('summary-landings').textContent`), /4/);
  assert.equal(await evaluate(`document.getElementById('summary-utc').textContent.includes('UTC')`), true);
  const won = await snapshot();
  await exportJournal('won');
  await open(true);
  assert.equal(await snapshot(), won);
  assert.equal(await evaluate(`document.getElementById('mission-summary').hidden`), false);

  if (mobile) {
   await send('Emulation.setDeviceMetricsOverride', {width:320,height:844,deviceScaleFactor:1,mobile:true});
   await menuClick('#save-mission');
   assert.equal(await evaluate(`(()=>{const r=document.querySelector('.session-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()`), true);
   await click('#session-menu summary', mobile);
  }
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await mkdir('.build/previews', {recursive:true});
  const shot = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  await writeFile(`.build/previews/spike-result-${mobile?'mobile':'desktop'}.png`, Buffer.from(shot.data,'base64'));

  await click('#restart-mission', mobile);
  assert.equal((await state()).flights, 0);
  assert.equal((await state()).stocks.BIKF, 64000);
  await open(true);
  assert.equal((await state()).flights, 0, 'Reload after restart must not resurrect the previous party');

  await flyTo('BIKF');
  const pending = await snapshot();
  await evaluate('window.confirm=()=>false');
  await menuClick('#new-mission');
  assert.equal(await snapshot(), pending, 'Cancelling a new party must preserve the old one');
  await evaluate('window.confirm=()=>true');
  await menuClick('#new-mission');
  assert.equal((await state()).flights, 0);
  assert.equal((await state()).activeFlight, null);

  // Corrupt startup data must survive pagehide until an explicit replacement.
  await evaluate(`${app}.destroy();localStorage.setItem('into-the-night-flight-v3','{')`);
  await open(true);
  assert.match(await evaluate(`document.getElementById('session-message').textContent`), /Не удалось/);
  await evaluate(`window.dispatchEvent(new Event('pagehide'))`);
  assert.equal(await evaluate(`localStorage.getItem('into-the-night-flight-v3')`), '{');
  await menuClick('#save-mission');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('into-the-night-flight-v3')).version`), 3);

  await open();
  const ground=await state();
  await evaluate(`(()=>{const a=${app},c=a.controller;c.waitUntil(c.view.state.utcMs+3600000,0);c.pause(0);a.advanceTo(c.view.state.utcMs+1800000);})()`);
  const waiting=await snapshot();
  assert.equal((await state()).phase,'waiting');
  await menuClick('#save-mission');await open(true);
  assert.equal(await snapshot(),waiting);
  assert.equal(await evaluate(`${app}.controller.playing`),false);
  assert.match(await evaluate(`document.getElementById('phase-name').textContent`),/Ожидание/);
  await evaluate(`${app}.controller.cancelWait(0);${app}.render()`);
  const stopped=await state();
  assert.equal(stopped.phase,'planning');assert.equal(stopped.flights,0);
  assert.equal(stopped.fuelKg,ground.fuelKg);assert.deepEqual(stopped.stocks,ground.stocks);
  assert.equal(stopped.utcMs,ground.utcMs+1800000);

  return {viewport:mobile?'390/320 touch':'1280 desktop',passed:true,steps:[
   'secondary session menu', 'cruise save and paused reload', 'refuel reload without stock reset',
   'file import and damaged/old save rejection', 'journal replay through CLI',
   'recoverable storage failure', 'complete western route and result', 'persistent restart',
  ]};
 } finally {
  await rm(directory, {recursive:true,force:true});
 }
}
