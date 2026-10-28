// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {openFlightPage} from './browser-navigation.mjs';
export async function chapterOneScenarioRun({send,evaluate,until,click,rootUrl,mobile}){
 const app='window.chapterApp',directory=await mkdtemp(`${tmpdir()}/chapter-one-`);
 const state=()=>evaluate(`${app}.controller.view.state`),save=()=>evaluate(`${app}.controller.session.save()`);
 async function open(preserveSave=false){await openFlightPage({send,evaluate,until,rootUrl,preserveSave,campaign:true});await evaluate(`import('./app.mjs').then(m=>{window.chapterApp=m.app;return true;})`);}
 async function fly(to){await evaluate(`${app}.select('${to}')`);await click('#fly',mobile);await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);}
 async function shot(name){const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await mkdir('.build/previews',{recursive:true});await writeFile(`.build/previews/chapter-one-${name}-${mobile?'mobile':'desktop'}.png`,Buffer.from(result.data,'base64'));}
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});
  await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});await open();
  assert.equal((await state()).scenarioId,'campaign-chapter-one');assert.equal((await state()).fuelKg,65000);
  assert.match(await evaluate(`document.getElementById('campaign-panel').textContent`),/Свет смертелен.*Академгородке/s);
  for(const to of ['BIKF','CYEG','UHMA'])await fly(to);
  const before=await save();await evaluate(`${app}.select('UNNT')`);
  assert.equal(await save(),before,'Preflight ground preview must be free');
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('#expedition-card .footnote')).display`),'none');
  const preview=await evaluate(`document.getElementById('expedition-card').textContent`);
  assert.match(preview,/Дорога 1 ч 30 мин.*данные 1 ч 0 мин.*обратно 1 ч 30 мин/s);
  assert.match(preview,/Ночи хватает.*После обслуживания.*Данные:.*У самолёта:.*После возвращения до рассвета.*1 ч 12 мин/s);
  assert.equal(await evaluate(`document.getElementById('expedition-start').hidden`),true,'No expedition before landing');
  await evaluate(`document.getElementById('expedition-card').scrollIntoView({block:'center'})`);await shot('preflight');
  await click('#fly',mobile);await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  assert.equal((await state()).status,'running');assert.equal(await evaluate(`document.getElementById('mission-summary').hidden`),true);
  assert.equal(await evaluate(`document.getElementById('expedition-start').disabled`),false);
  const airport=await state();await click('#expedition-start',mobile);await click('#play-pause',mobile);
  const groundStart=(await state()).activeGround.startUtcMs;
  for(const [offset,phase,count] of [[2700000,'ground_outbound',0],[7200000,'ground_acquisition',0],[10800000,'ground_return',1]]){
   await evaluate(`${app}.advanceTo(${groundStart+offset})`);
   const paused=await save(),s=await state();assert.equal(s.phase,phase);assert.equal(s.campaign.knowledgeIds.length,count);
   assert.notDeepEqual(s.position,s.aircraft.position);assert.equal(s.aircraft.airportId,'UNNT');
   assert.equal(await evaluate(`document.getElementById('fly').disabled`),true);
   assert.equal(await evaluate(`${app}.controller.session.fly('UACC').allowed`),false);
   assert.match(await evaluate(`document.getElementById('campaign-location').textContent`),/Самолёт оставлен.*Взлёт после возвращения/);
   assert.equal(await evaluate(`JSON.parse(localStorage.getItem('into-the-night-campaign-v1')).payload.cursorUtcMs`),s.utcMs);
   await open(true);assert.equal((await state()).utcMs,s.utcMs,await evaluate(`document.getElementById('session-message').textContent`));assert.equal(await save(),paused);assert.equal(await evaluate(`${app}.controller.playing`),false);
   assert.equal((await state()).fuelKg,airport.fuelKg);assert.deepEqual((await state()).stocks,airport.stocks);
  }
  await evaluate(`${app}.globe.focus(${app}.controller.view.state.position,256);${app}.render()`);
  assert.equal(await evaluate(`${app}.globe.playerPose!==null`),true);
  assert.notEqual(await evaluate(`${app}.globe.playerPose.x`),await evaluate(`${app}.globe.planePose.x`));
  if(mobile){await send('Emulation.setDeviceMetricsOverride',{width:320,height:844,deviceScaleFactor:1,mobile:true});await evaluate(`${app}.render()`);}
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);await shot('return-paused');
  const exported=await save(),path=directory+'/ground.json';await writeFile(path,exported);
  const cli=spawnSync(process.execPath,['scripts/mission-cycle-cli.mjs','--load',path],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).state.phase,'ground_return');
  await evaluate(`${app}.advanceTo(${app}.controller.session.endUtcMs)`);
  assert.equal((await state()).campaign.chapterOneCompleted,true);assert.equal((await state()).status,'running');
  assert.equal(await evaluate(`document.getElementById('knowledge-count').textContent`),'1');
  assert.match(await evaluate(`document.getElementById('campaign-objective').textContent`),/Глава 1 завершена.*Цукуба/);
  await fly('UACC');assert.equal((await state()).airportId,'UACC');assert.equal((await state()).campaign.knowledgeIds.length,1);
  await open(true);assert.equal((await state()).airportId,'UACC');assert.equal((await state()).campaign.knowledgeIds.length,1);
  // Recreate the old airport conditions as a separate campaign fixture. Its card must explain the road sunrise.
  await evaluate(`(async()=>{const m=await import('./app.mjs'),d=${app}.controller.session.definition;d.initial.utcMs=Date.parse('2026-08-01T20:00:00Z');d.initial.fuelKg=30000;${app}.destroy();localStorage.removeItem('into-the-night-campaign-v1');window.chapterApp=await m.createFlightApp(d,{type:'MultiPolygon',coordinates:[]});for(const to of ['BIKF','CYEG','UHMA']){${app}.controller.select(to);${app}.controller.fly(0);${app}.advanceTo(${app}.controller.session.endUtcMs);} ${app}.select('UNNT');})()`);
  assert.match(await evaluate(`document.getElementById('expedition-card').textContent`),/Ночи не хватает.*Солнце: Возвращение.*позже рассвета/s);
  await evaluate(`document.getElementById('expedition-card').scrollIntoView({block:'center'})`);await shot('late-arrival');
  await fly('UNNT');assert.equal(await evaluate(`document.getElementById('expedition-start').disabled`),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  return {viewport:mobile?'390/320 touch':'1280 desktop',passed:true,steps:['preflight four-hour expedition and computed margin','landing does not win','three ground phases pause/reload','separate player and plane locations','one knowledge and chapter return','export resumes in CLI','inherited safe UACC flight','late arrival explains road sunrise']};
 }finally{await evaluate(`${app}?.destroy()`);await rm(directory,{recursive:true,force:true});}
}
