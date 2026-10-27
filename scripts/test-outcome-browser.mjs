// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {SOLAR_MODEL} from '../dist/core/config.js';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
const base=await loadCycleDefinition();
function fixture(kind){const d=structuredClone(base);d.scenarioId='synthetic-browser-outcome';d.worldVersion='synthetic-outcome-world-v1';d.profile.id='synthetic-outcome-profile';d.seed='browser-outcome-42';d.profile.assumptions.zeroFuelKg=60000;
 d.airports=['A','B','C','D'].map((id,i)=>({id,name:'Аэродром '+id,label:'Аэродром '+id,country:'Тест',latitudeDeg:['sun','failed'].includes(kind)?80:-80,longitudeDeg:i===3?90:i*90,suitability:{status:i>=2?'unverified':'screened-candidate'}}));
 d.targetId='C';d.initial={airportId:'A',utcMs:kind==='failed'?SOLAR_MODEL.endUtcMsExclusive-60000:Date.parse('2026-06-21T00:00:00Z'),fuelKg:kind==='lost'?1:5000,stocks:{A:kind==='lost'?0:50000,B:50000,C:0,D:0}};return d;}
export async function outcomeScenarioRun({send,evaluate,until,click,rootUrl,mobile}){
 await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
 let scriptId=null;
 async function open(kind,{fake=false}={}){
  if(scriptId)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId});
  const script=`(()=>{const original=window.fetch.bind(window);window.fetch=(input,...args)=>String(input).endsWith('/data/runtime/mission.json')?Promise.resolve(new Response(${JSON.stringify(JSON.stringify(fixture(kind)))},{headers:{'Content-Type':'application/json'}})):original(input,...args);
   ${fake?`window.outcomeWorkers=[];window.Worker=class{constructor(){this.requests=[];window.outcomeWorkers.push(this);}postMessage(data){this.requests.push(data);}terminate(){this.terminated=true;}};`:''}})()`;
  scriptId=(await send('Page.addScriptToEvaluateOnNewDocument',{source:script})).identifier;
  await send('Page.navigate',{url:rootUrl});await until(`document.body.dataset.ready==='true'`);
  await evaluate(`import('./app.mjs').then(m=>{window.outcomeApp=m.app;return true;})`);
 }
 const app='window.outcomeApp';
 await open('available');await until(`${app}.planner.summary().complete`);assert.deepEqual(await evaluate(`${app}.planner.summary().availableIds`),['B']);
 const saved=await evaluate(`${app}.controller.session.save()`);
 await evaluate(`${app}.globe.focus({latitudeDeg:80,longitudeDeg:0},1);${app}.render()`);
 assert.equal(await evaluate(`${app}.globe.hits.length`),0);assert.match(await evaluate(`document.getElementById('availability-title').textContent`),/1/);assert.equal(await evaluate(`${app}.controller.view.state.status`),'running');assert.equal(await evaluate(`${app}.controller.session.save()`),saved);
 await evaluate(`${app}.globe.focus(${app}.controller.session.definition.airports.find(a=>a.id==='B'),5);${app}.render()`);
 assert.equal(await evaluate(`${app}.globe.hits.some(h=>h.group.some(a=>a.id==='B')&&h.group.some(a=>a.id==='D'))`),true,'The only safe airport must remain inside a selectable group');
 await open('lost');await until(`${app}.controller.view.state.status==='lost'`);
 assert.equal(await evaluate(`${app}.controller.view.state.result.kind`),'no_routes');assert.equal(await evaluate(`${app}.controller.view.state.death`),null);assert.equal(await evaluate(`${app}.controller.view.state.utcMs`),fixture('lost').initial.utcMs);assert.equal(await evaluate(`${app}.controller.view.state.fuelKg`),1);
 assert.match(await evaluate(`document.getElementById('availability-title').textContent`),/Поражение: маршрут оборвался/);assert.match(await evaluate(`document.getElementById('availability-detail').textContent`),/Нет доступных перелётов/);assert.match(await evaluate(`document.getElementById('availability-reasons').textContent`),/Топливо: 1/);assert.equal(await evaluate(`document.getElementById('flight-planning-card').hidden`),true);assert.equal(await evaluate(`document.getElementById('restart-mission').hidden`),false);
 await mkdir('.build/previews',{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(`.build/previews/no-routes-${mobile?'mobile':'desktop'}.png`,Buffer.from(shot.data,'base64'));if(process.env.GLOBE_PREVIEW_LOG==='1')console.log(`NO_ROUTES_${mobile?'MOBILE':'DESKTOP'} ${shot.data}`);
 const generation=await evaluate(`${app}.planner.generation`);await click('#restart-mission',mobile);await until(`${app}.controller.view.state.status==='lost'`);assert.ok(await evaluate(`${app}.planner.generation`)>generation);assert.equal(await evaluate(`${app}.controller.view.events.filter(e=>e.kind==='mission_lost').length`),1);assert.equal(await evaluate(`${app}.controller.view.state.flights`),0);
 await open('sun');await until(`${app}.controller.view.state.status==='dead'`);assert.equal(await evaluate(`${app}.controller.view.state.result.kind`),'sun');assert.match(await evaluate(`document.getElementById('availability-title').textContent`),/самолёт встретил Солнце/);assert.equal(await evaluate(`${app}.controller.view.events.some(e=>e.kind==='mission_lost')`),false);
 await open('failed');await until(`${app}.planner.summary().status==='failed'`);assert.equal(await evaluate(`${app}.controller.view.state.status`),'running');assert.equal(await evaluate(`${app}.controller.view.state.result`),null);assert.match(await evaluate(`document.getElementById('availability-title').textContent`),/Проверка не завершена/);assert.equal(await evaluate(`document.getElementById('retry-scan').hidden`),false);
 await open('available',{fake:true});await until(`window.outcomeWorkers[0]?.requests.length>0`);
 assert.equal(await evaluate(`${app}.planner.summary().checked`),0);assert.equal(await evaluate(`${app}.controller.view.state.result`),null);
 await evaluate(`(()=>{const w=window.outcomeWorkers[0],r=w.requests[0];w.onmessage({data:{...r,batch:[{id:'B',allowed:false,reasons:['solar_indeterminate']}],done:false}});})()`);
 assert.equal(await evaluate(`${app}.planner.summary().checked`),1);assert.equal(await evaluate(`${app}.controller.view.state.status`),'running');assert.match(await evaluate(`document.getElementById('availability-detail').textContent`),/осталось 2/);
 await evaluate(`(()=>{const w=window.outcomeWorkers[0],r=w.requests[0];w.onmessage({data:{...r,batch:['C','D'].map(id=>({id,allowed:false,reasons:['unverified_airport']})),done:true}});})()`);
 assert.equal(await evaluate(`${app}.planner.summary().status`),'unresolved');assert.match(await evaluate(`document.getElementById('availability-title').textContent`),/Безопасность ещё не определена/);assert.equal(await evaluate(`${app}.controller.view.state.status`),'running');
 await click('#retry-scan',mobile);await until(`window.outcomeWorkers.length===2`);
 await evaluate(`(()=>{const w=window.outcomeWorkers[0],r=w.requests[0];w.onmessage({data:{...r,batch:['B','C','D'].map(id=>({id,allowed:false,reasons:['sun']})),done:true}});})()`);
 assert.equal(await evaluate(`${app}.planner.summary().checked`),0);assert.equal(await evaluate(`${app}.controller.view.state.result`),null);
 await evaluate(`window.outcomeWorkers[1].onerror()`);await until(`${app}.planner.summary().complete`);assert.deepEqual(await evaluate(`${app}.planner.summary().availableIds`),['B']);assert.equal(await evaluate(`${app}.controller.view.state.status`),'running');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 if(scriptId)await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:scriptId});
 return {viewport:mobile?'390x844 touch':'1280x900 mouse',passed:true,steps:['safe destination behind globe and inside group','full-catalog loss without Sun or resource mutation','restart with fresh journal','separate Sun death','failed analysis is not a loss','partial and uncertain transport','late reply after retry ignored','worker error fallback']};
}
