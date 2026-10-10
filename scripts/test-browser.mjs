import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const directory=mkdtempSync(`${tmpdir()}/into-the-night-browser-`);
const base=process.env.SPIKE_TEST_BASE??'/';
const gameUrl='http://127.0.0.1:5983'+base;
const chromePath=process.env.SPIKE_CHROME_PATH??'google-chrome';
let browser,server,socket,id=0,sessionId,browserLog='';const pending=new Map(),errors=[];
function send(method,params={},session=sessionId){
 return new Promise((resolve,reject)=>{
  const call=++id,timer=setTimeout(()=>{pending.delete(call);reject(Error(`CDP timeout: ${method}`));},15000);
  pending.set(call,{resolve,reject,timer});
  socket.send(JSON.stringify({id:call,method,params,...(session?{sessionId:session}:{})}));
 });
}
async function evaluate(expression){
 const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
 return r.result.value;
}
async function until(expression){
 for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}
 throw Error(`Browser did not reach: ${expression}`);
}
async function click(selector,mobile){
 const position=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Unavailable control: '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 if(mobile){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[position]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
 else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...position});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...position});}
}
async function value(selector,text){await evaluate(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(String(text))}`);}
async function exportFile(selector,mobile){
 await evaluate(`window.lastExport=null;HTMLAnchorElement.prototype.click=function(){window.lastExport=fetch(this.href).then(r=>r.text());};`);
 await click(selector,mobile);return evaluate('window.lastExport');
}
async function scenarioRun(mobile){
 await send('Emulation.setDeviceMetricsOverride',{width:mobile?390:1280,height:mobile?844:900,deviceScaleFactor:1,mobile});
 await send('Emulation.setTouchEmulationEnabled',{enabled:mobile});
 await send('Page.navigate',{url:gameUrl});
 await until(`document.getElementById('clock')?.textContent.includes('2026-11-20') && document.getElementById('message')?.textContent.includes('Выберите')`);
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Horizontal overflow');
 assert.match(await evaluate(`document.getElementById('destination-card').textContent`),/примерно/);
 const initial=JSON.parse(await exportFile('#export-journal',mobile));
 await value('#fuel',9000);await value('#food',0);await click('#add-load',mobile);
 assert.equal(await evaluate(`document.getElementById('execute').disabled`),true);
 await click('#clear',mobile);await value('#fuel',600);await value('#food',12);await click('#add-load',mobile);await click('#add-flight',mobile);
 await value('#preview-time','2026-11-20T04:00:00Z');await click('#preview',mobile);
 assert.match(await evaluate(`document.getElementById('mode').textContent`),/ПРОГНОЗ/);
 assert.match(await evaluate(`document.getElementById('resources').textContent`),/примерно/);
 assert.equal(JSON.parse(await exportFile('#export-journal',mobile)).state.currentTimeUtc,initial.state.currentTimeUtc);
 await click('#present',mobile);await click('#execute',mobile);await click('#pause',mobile);
 await evaluate(`(()=>{const slider=document.getElementById('progress');slider.value=400;slider.dispatchEvent(new Event('input'));})()`);
 const flightSave=await exportFile('#export-save',mobile),flightJournal=JSON.parse(await exportFile('#export-journal',mobile));
 assert.equal(flightJournal.state.aircraft.airportId,null);assert.equal(flightJournal.state.aircraft.activeFlight.stage,'cruise');
 await click('#save',mobile);await click('#restore-local',mobile);
 assert.equal(await exportFile('#export-save',mobile),flightSave,'Flight restore changed save');
 await click('#finish',mobile);await click('#add-service',mobile);await click('#execute',mobile);await click('#finish',mobile);
 await value('#wait-days',30);await click('#add-wait',mobile);await click('#execute',mobile);await click('#pause',mobile);
 await evaluate(`(()=>{const slider=document.getElementById('progress');slider.value=500;slider.dispatchEvent(new Event('input'));})()`);
 const clock=await evaluate(`document.getElementById('clock').textContent`),paused=await exportFile('#export-save',mobile);
 await click('#save',mobile);await click('#restore-local',mobile);
 assert.equal(await evaluate(`document.getElementById('clock').textContent`),clock);
 assert.equal(await exportFile('#export-save',mobile),paused,'Waiting restore changed save');
 await click('#resume',mobile);await evaluate('new Promise(r=>setTimeout(r,80))');await click('#pause',mobile);
 await click('#stop',mobile);await value('#wait-days',15);await click('#add-wait',mobile);await click('#execute',mobile);await click('#finish',mobile);
 const review=await exportFile('#export-journal',mobile),journal=JSON.parse(review);
 assert.ok(journal.state.achievements.includes(30));assert.equal(journal.state.completedFlights,1);
 assert.ok(journal.entries.some(e=>e.cancelGround));assert.equal('stocks' in journal.state,false);
 const path=`${directory}/${mobile?'mobile':'desktop'}-review.json`;writeFileSync(path,review);
 const cli=spawnSync(process.execPath,['scripts/review-cli.mjs',path],{encoding:'utf8'});
 assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).passed,true);
 // Explicit risk confirmation must leave UTC frozen until the affirmative click.
 await send('Page.navigate',{url:gameUrl});
 await until(`document.getElementById('clock')?.textContent.includes('2026-11-20') && document.getElementById('message')?.textContent.includes('Выберите')`);
 await value('#wait-days',1);await click('#add-wait',mobile);await click('#execute',mobile);
 assert.equal(await evaluate(`document.getElementById('risk').open`),true);
 assert.match(await evaluate(`document.getElementById('risk-text').textContent`),/Солнце.*UTC/);
 assert.match(await evaluate(`document.getElementById('clock').textContent`),/00:00:00/);
 await click('#risk-no',mobile);await click('#execute',mobile);await click('#risk-yes',mobile);await click('#finish',mobile);
 assert.match(await evaluate(`document.getElementById('result').textContent`),/Партия завершена: Солнце/);
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 return {viewport:mobile?'390x844 touch':'1280x900 mouse',passed:true,reviewEntries:journal.entries.length,
  steps:['invalid load blocked','forecast without time/resource/discovery mutation','flight pause/save/restore',
   'loading/flight/service','30-day waiting with 15-day pause and ground stop','resume saved action',
   'exported review matches CLI','explicit solar-risk confirmation and death summary','no horizontal overflow']};
}
try {
 server=spawn(process.execPath,['scripts/dev-server.mjs','--built','--port','5983','--base',base],{stdio:['ignore','ignore','pipe']});
 let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(gameUrl)).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 assert.ok(ready,'Local build server did not start');
 browser=spawn(chromePath,['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${directory}/profile`,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{stdio:['ignore','ignore','pipe']});
 browser.on('error',e=>{browserLog+=e.message;});
 browser.stderr.on('data',b=>{browserLog=(browserLog+b.toString()).slice(-6000);});
 let endpoint=null;
 for(let i=0;i<200;i++){
  try{const [port,path]=readFileSync(`${directory}/profile/DevToolsActivePort`,'utf8').trim().split('\n');endpoint=`ws://127.0.0.1:${port}${path}`;break;}catch{}
  if(browser.exitCode!==null)throw Error(`Chrome exited: ${browser.exitCode}\n${browserLog}`);
  await new Promise(r=>setTimeout(r,50));
 }
 if(!endpoint)throw Error('Chrome did not open its debugging endpoint: '+browserLog);
 socket=new WebSocket(endpoint);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Cannot connect to Chrome: '+browserLog)),{once:true});});
 socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);if(p){clearTimeout(p.timer);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}}
  else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
 });
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
 sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');
 const version=await send('Browser.getVersion',{},null);
 const results=[await scenarioRun(false),await scenarioRun(true)];assert.deepEqual(errors,[]);
 process.stdout.write(JSON.stringify({passed:true,browser:version.product,base,results},null,2)+'\n');
}catch(e){process.stderr.write(e.stack+'\n'+browserLog+'\n');process.exitCode=1;}
finally{socket?.close();browser?.kill();server?.kill();for(const p of pending.values())clearTimeout(p.timer);rmSync(directory,{recursive:true,force:true});}
