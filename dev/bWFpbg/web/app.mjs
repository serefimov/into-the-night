import {SpikeGame} from '../dist/core/game.js';
import {mapRoute} from '../dist/core/map.js';
import {solarDirection,surfaceNormal,solarExposure} from '../dist/core/solar.js';
import {parseUtc} from '../dist/core/time.js';
const $=id=>document.getElementById(id);
const [catalog,scenario]=await Promise.all(['airports','scenario'].map(n=>fetch(new URL(`../data/spike/${n}.json`,import.meta.url)).then(r=>{if(!r.ok)throw Error('Не удалось открыть сценарий');return r.json();})));
let game=new SpikeGame(catalog,scenario),queue=[],preview=null,running=false,lastFrame=0,animationRate=1,actionStart=game.current().currentTimeUtc,frameId=null;
function halt(){running=false;if(frameId!==null)cancelAnimationFrame(frameId);frameId=null;}
const airports=catalog.airports,canvas=$('map'),ctx=canvas.getContext('2d');
const number=v=>Number(v).toLocaleString('ru-RU',{maximumFractionDigits:1});
const utc=v=>new Date(v).toISOString().replace('T',' ').replace('Z',' UTC');
const duration=s=>`${number(s/86400)} суток (${number(s/3600)} ч)`;
const reason=r=>({sun:'Солнце',food:'Голод',fuel:'Недостаток топлива',food_threshold:'Еды осталось на 72 часа экипажа',sunrise_warning:'До Солнца осталось 12 часов',search_horizon:'Достигнут горизонт поиска',uncertainty:'Нужно уточнить прогноз'}[r]??r);
const outcome=r=>({completed:'Безопасность всего плана подтверждена',death:'План приводит к гибели',validation_error:'План заблокирован',needs_refinement:'Безопасность не определена: требуется уточнение',needs_discovery:'Продолжение требует посадки и нового планирования',waiting_stopped:'Ожидание до первого порога'}[r]??r);
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('danger',error);}
function uiError(text){
 if(/Loading exceeds/.test(text))return 'Загрузка превышает запас склада или свободную вместимость.';
 if(/Insufficient fuel/.test(text))return 'Недостаточно топлива для перелёта.';
 if(/Amounts must/.test(text))return 'Количество ресурсов должно быть конечным и неотрицательным.';
 if(/checksum|Invalid spike save|Noncontiguous|Unsupported save|Scenario, seed/.test(text))return 'Сохранение повреждено или относится к другой версии сценария.';
 if(/Flight requires/.test(text))return 'Перед вылетом нужны обслуживание и подготовка.';
 return text;
}
function guard(fn){return (...args)=>{try{fn(...args);}catch(e){message(uiError(e.message),true);}};}
function actionName(a){return ({prepare:'Подготовка · 15 мин',service:'Обслуживание · 15 мин',auto_wait:'Автоожидание до первого порога'}[a.kind]??(a.kind==='fly'?`Перелёт в ${a.destinationId}`:a.kind==='load'?`Погрузка ${number(a.fuelKg)} кг / ${number(a.foodPersonHours/30)} ч экипажа`:`Ожидание ${duration(a.seconds)}`));}
function persist(){try{localStorage.setItem('into-the-night-spike-1',game.save());}catch{message('Не удалось записать браузерное сохранение. Скачайте файл.',true);}}
function add(actions){
 if(game.active || preview)throw Error('Вернитесь к текущей партии и завершите или остановите действие.');
 if(queue.some(a=>['fly','auto_wait'].includes(a.kind)))throw Error('Перелёт и автоожидание завершают пакет. Выполните его, затем планируйте дальше.');
 queue.push(...actions);render();
}
function download(name,text){const blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function planInfo(f){
 const lines=[outcome(f.outcome),`До ${utc(f.state.currentTimeUtc)} · ${duration((f.state.currentTimeUtc-game.current().currentTimeUtc)/1000)}`,
  `На борту: ${number(f.state.aircraft.fuelKg)} кг / ${number(f.state.aircraft.foodPersonHours/30)} ч экипажа`];
 if(f.state.death)lines.push(`${reason(f.state.death.reason)}: ${utc(f.state.death.utcMs)}`);
 if(f.message)lines.push(uiError(f.message));
 if(f.events.some(e=>e.kind==='loading_limited'))lines.push('Погрузка будет частичной: склад одновременно кормит экипаж.');
 if(f.events.some(e=>e.kind==='manual_wait_risk'))lines.push('Ручное ожидание после предупреждения требует подтверждения.');
 return lines.join('\n');
}
function lines(id,text){$(id).textContent=text;$(id).style.whiteSpace='pre-line';}
function selectAirport(id){$('destination').value=id;render();}
for(const a of airports){
 const option=document.createElement('option');option.value=a.id;option.textContent=`${a.id} · ${a.name}`;$('destination').append(option);
 const button=document.createElement('button');button.textContent=a.id;button.dataset.airport=a.id;button.onclick=()=>selectAirport(a.id);$('airports').append(button);
}
$('destination').value='LYR';$('destination').onchange=()=>render();
const normals=[];
for(let lat=-88.5;lat<90;lat+=3)for(let lon=-178.5;lon<180;lon+=3)normals.push({lat,lon,n:surfaceNormal({latitudeDeg:lat,longitudeDeg:lon})});
const silhouettes=[
 [[-168,70],[-125,72],[-105,50],[-82,25],[-62,48],[-82,70],[-115,83]],
 [[-80,12],[-50,0],[-35,-8],[-66,-56],[-76,-25]],
 [[-54,59],[-22,73],[-45,83],[-65,77]],
 [[-17,35],[32,32],[52,11],[35,-35],[17,-35],[-10,0]],
 [[-10,36],[10,60],[35,70],[65,74],[130,70],[180,65],[150,45],[110,0],[78,8],[45,35],[30,40]],
 [[113,-22],[130,-12],[153,-28],[145,-40],[115,-34]],
 [[-180,-72],[-90,-76],[0,-70],[90,-75],[180,-72],[180,-90],[-180,-90]]
];
function drawMap(state){
 const width=canvas.width,height=canvas.height,sun=solarDirection(state.currentTimeUtc);
 const xy=p=>[(p.longitudeDeg+180)/360*width,(90-p.latitudeDeg)/180*height];
 ctx.clearRect(0,0,width,height);
 for(const {lat,lon,n} of normals){const q=n[0]*sun[0]+n[1]*sun[1]+n[2]*sun[2];ctx.fillStyle=q>=0?'#405c73':'#0e2136';ctx.fillRect((lon+178.5)/360*width,(88.5-lat)/180*height,width/120+1,height/60+1);}
 ctx.strokeStyle='#b2c3d530';ctx.lineWidth=1;
 for(const poly of silhouettes){ctx.beginPath();poly.forEach(([lon,lat],i)=>{const [x,y]=xy({longitudeDeg:lon,latitudeDeg:lat});i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.stroke();}
 ctx.strokeStyle='#8299b030';
 for(let lat=-60;lat<=60;lat+=30){ctx.beginPath();ctx.moveTo(0,(90-lat)/180*height);ctx.lineTo(width,(90-lat)/180*height);ctx.stroke();}
 for(let lon=-180;lon<=180;lon+=60){ctx.beginPath();ctx.moveTo((lon+180)/360*width,0);ctx.lineTo((lon+180)/360*width,height);ctx.stroke();}
 const origin=airports.find(a=>a.id===(state.aircraft.airportId??state.aircraft.activeFlight?.from)),destination=airports.find(a=>a.id===$('destination').value);
 if(origin && destination && origin.id!==destination.id){
  ctx.strokeStyle='#eed193';ctx.lineWidth=3;
  for(const line of mapRoute(origin,destination)){ctx.beginPath();line.forEach((p,i)=>{const [x,y]=xy(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
 }
 for(const a of airports){const [x,y]=xy(a);ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.fillStyle=solarExposure(a,state.currentTimeUtc).safe?'#7ce5cd':'#ff9d90';ctx.fill();ctx.fillStyle='#fff';ctx.font='15px system-ui';ctx.fillText(a.id,x+10,y+16+airports.indexOf(a)*4);}
 const [x,y]=xy(state.aircraft.position);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
 ctx.fillStyle='#b9c6d5';ctx.font='12px system-ui';ctx.fillText('180°W',8,height-8);ctx.fillText('0°',width/2,height-8);ctx.fillText('180°E',width-45,height-8);
}
canvas.onclick=e=>{
 const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*360-180,y=90-(e.clientY-rect.top)/rect.height*180;
 const nearest=[...airports].sort((a,b)=>Math.hypot(a.longitudeDeg-x,a.latitudeDeg-y)-Math.hypot(b.longitudeDeg-x,b.latitudeDeg-y))[0];
 if(Math.hypot(nearest.longitudeDeg-x,nearest.latitudeDeg-y)<12)selectAirport(nearest.id);
};
function render(full=true){
 const state=preview?.state??game.current(),actual=game.current();
 $('clock').textContent=utc(state.currentTimeUtc);
 $('mode').textContent=preview?'ПРОГНОЗ · партия остаётся на прежнем UTC':game.active?(running?'ПЕРЕМОТКА · текущая партия':'ПАУЗА · текущая партия'):'ТЕКУЩАЯ ПАРТИЯ · UTC заморожен';
 if(state.waitingWarning)$('mode').textContent+=' · ПРЕДУПРЕЖДЕНИЕ';
 $('mode').classList.toggle('preview',!!preview);
 const stock=state.aircraft.airportId?state.warehouses[state.aircraft.airportId]:null;
 $('resources').replaceChildren();
 for(const [label,value] of [['Топливо',`${number(state.aircraft.fuelKg)} кг`],['Еда на борту',`${number(state.aircraft.foodPersonHours/30)} ч`],['Выживание',`${number((state.currentTimeUtc-state.startTimeUtc)/86400000)} суток`],['Склад здесь',stock?(Array.isArray(stock.foodPersonHours)?`${stock.foodPersonHours.map(v=>number(v/720)).join('–')} дней, примерно`:`${number(stock.foodPersonHours/720)} дней еды`):'В полёте']]){
  const span=document.createElement('span'),b=document.createElement('b');b.textContent=value;span.append(label,b);$('resources').append(span);
 }
 drawMap(state);
 $('movement').hidden=!game.active;$('pause').disabled=!running;$('resume').disabled=running;
 $('stop').disabled=running || !actual.aircraft.airportId || !game.active;
 if(game.active){$('progress').value=Math.round((actual.currentTimeUtc-actionStart)/(game.endUtcMs-actionStart)*1000);$('progress').min=$('progress').value;}
 $('result').hidden=!state.death;
 if(state.death){lines('result',`Партия завершена: ${reason(state.death.reason)}\n${duration((state.currentTimeUtc-state.startTimeUtc)/1000)} · ${number(state.distanceKm)} км\nПерелётов ${state.completedFlights} · аэропортов ${state.discovered.length}\n${utc(state.death.utcMs)}\n${state.simulationVersion} · ${state.scenarioId} v${state.scenarioVersion} · seed ${state.seed}`);}
 if(!full)return;
 for(const button of $('airports').children)button.setAttribute('aria-pressed',String(button.dataset.airport===$('destination').value));
 const blocked=game.active||!!preview||!!actual.death;
 for(const el of $('planner').querySelectorAll('button,input'))el.disabled=blocked;
 $('add-flight').disabled=blocked||$('destination').value===actual.aircraft.airportId;
 $('preview').disabled=game.active||!!actual.death;
 $('plan').replaceChildren();
 queue.forEach((a,i)=>{const li=document.createElement('li');li.textContent=actionName(a);const b=document.createElement('button');b.textContent='Убрать';b.disabled=blocked;b.onclick=()=>{queue.splice(i,1);render();};li.append(b);$('plan').append(li);});
 if(!blocked){
  if(queue.length){const f=game.forecast(queue);lines('forecast',planInfo(f));$('forecast').classList.toggle('danger',['death','validation_error','needs_refinement'].includes(f.outcome));$('execute').disabled=['validation_error','needs_refinement'].includes(f.outcome);}else{lines('forecast','Выберите действия. Планирование не расходует время.');$('execute').disabled=true;}
  const standing=game.standing();
  lines('standing',`${standing.maximum.status==='needs_refinement'?'Стоянка требует уточнения':'Максимальная стоянка (до границы)'}: ${duration(standing.maximum.seconds)}\nОграничение: ${reason(standing.maximum.reason)} · ${utc(standing.maximum.boundaryUtcMs)}\nАвтоостановка: ${utc(standing.automatic.stopUtcMs)} · ${standing.automatic.reasons.map(reason).join(', ')}\nПоиск Солнца: 370 суток, ${standing.sunrise.status==='found'?utc(standing.sunrise.eventUtcMs):standing.sunrise.status==='indeterminate'?'нуждается в уточнении':'не найдено в доступном горизонте'}${standing.sunrise.rangeLimited?' (ограничен диапазоном модели)':''}`);
  if($('destination').value!==actual.aircraft.airportId){
   const flight=game.flight($('destination').value),warehouse=actual.warehouses[$('destination').value];
   const bounds=v=>Array.isArray(v)?`${number(v[0])}–${number(v[1])} (примерно)`:number(v);
   lines('destination-card',`${number(flight.distanceKm)} км · ${duration(flight.durationSeconds)}\nПлановое прибытие: ${utc(flight.arrivalUtcMs)}\nВесь путь: ${outcome(flight.forecast.outcome)}${flight.forecast.state.death?` · ${reason(flight.forecast.state.death.reason)} ${utc(flight.forecast.state.death.utcMs)}`:''}\nПрибытие: ${flight.arrivalSolar.safe?'темно':'Солнце'} · ${number(flight.arrivalSolar.altitudeDeg)}°\nРесурсы по прогнозу: ${number(flight.forecast.state.aircraft.fuelKg)} кг / ${number(flight.forecast.state.aircraft.foodPersonHours/30)} ч экипажа${flight.forecast.outcome==='completed'?'':' (план остановлен/заблокирован)'}\nСклад назначения: ${bounds(warehouse.fuelKg)} кг / ${Array.isArray(warehouse.foodPersonHours)?warehouse.foodPersonHours.map(v=>number(v/720)).join('–')+' дней (примерно)':number(warehouse.foodPersonHours/720)+' дней'}\nСледующее Солнце: ${flight.sunrise.status==='found'?utc(flight.sunrise.eventUtcMs):flight.sunrise.status} · горизонт 370 суток\nЗапас еды после посадки уточняется при открытии склада.`);
  }else lines('destination-card','Это текущий аэропорт. Можно загружаться и ждать.');
 }else{lines('standing','Стоянка рассчитывается при планировании. Остановите наземное действие или завершите перелёт.');if(game.active)lines('destination-card','Перелёт/операция выполняется. Новое планирование доступно после завершения или остановки на земле.');}
}
function animate(){
 frameId=null;
 if(!running||!game.active)return;
 const now=performance.now(),delta=Math.min(250,now-lastFrame);lastFrame=now;
 const next=Math.min(game.endUtcMs,game.current().currentTimeUtc+delta*animationRate);
 game.advance(next);render(false);
 if(game.active)frameId=requestAnimationFrame(animate);else{halt();queue=[];persist();render();message(game.current().death?'Партия завершена. Экспортируйте журнал для рецензии.':game.current().waitingWarning?game.current().waitingWarning.reasons.map(reason).join('; ')+'. Выберите следующий шаг.':'План завершён. Время остановлено; выбирайте следующий шаг.');}
}
function play(){
 if(!game.active)return;
 halt();
 animationRate=$('speed').value==='fit'?Math.max(1,(game.endUtcMs-game.current().currentTimeUtc)/12000):Number($('speed').value);
 running=true;lastFrame=performance.now();render();frameId=requestAnimationFrame(animate);
}
function launch(confirmRisk=false){
 preview=null;game.start(queue,confirmRisk);actionStart=game.current().currentTimeUtc;
 if(game.active&&game.endUtcMs===actionStart)game.advance(actionStart);
 persist();play();render();
 if(!game.active){queue=[];render();message('Порог уже достигнут: управление возвращено без ожидания.');}
}
$('execute').onclick=guard(()=>{
 const f=game.forecast(queue);
 if(f.outcome==='death'||f.events.some(e=>e.kind==='manual_wait_risk')){lines('risk-text',f.state.death?`${reason(f.state.death.reason)} при ${utc(f.state.death.utcMs)}. Исполнение остановится на первом поражении.`:'Порог уже был выдан. Ручное ожидание требует отдельного подтверждения. '+planInfo(f));$('risk').showModal();}
 else launch();
});
$('risk-yes').onclick=guard(()=>{$('risk').close();launch(true);});$('risk-no').onclick=()=>{$('risk').close();};
$('add-flight').onclick=guard(()=>add(game.flight($('destination').value).actions));
$('add-load').onclick=guard(()=>add([{kind:'load',fuelKg:Number($('fuel').value),foodPersonHours:Number($('food').value)*30}]));
$('add-service').onclick=guard(()=>add([{kind:'service'}]));$('add-prepare').onclick=guard(()=>add([{kind:'prepare'}]));
$('add-wait').onclick=guard(()=>add([{kind:'wait',seconds:Number($('wait-days').value)*86400}]));$('add-auto').onclick=guard(()=>add([{kind:'auto_wait'}]));
$('clear').onclick=()=>{queue=[];preview=null;render();};
$('pause').onclick=()=>{halt();persist();render();message('Пауза фиксирует показанный UTC. Можно продолжить или остановить действие на земле.');};
$('resume').onclick=guard(play);
$('stop').onclick=guard(()=>{halt();game.cancelGround();queue=[];persist();render();message('Действие остановлено на показанном UTC; фактические ресурсы сохранены.');});
$('finish').onclick=guard(()=>{halt();game.advance(game.endUtcMs);queue=[];persist();render();message('Достигнут конец рассчитанного действия или первое событие.');});
$('progress').oninput=guard(()=>{halt();const next=actionStart+(game.endUtcMs-actionStart)*Number($('progress').value)/1000;game.advance(Math.max(game.current().currentTimeUtc,next));persist();if(!game.active)queue=[];render();});
$('speed').onchange=()=>{if(running){halt();play();}};
$('preview').onclick=guard(()=>{const target=parseUtc($('preview-time').value),now=game.current().currentTimeUtc;if(target<now)throw Error('Прогнозная дата должна быть не раньше текущего UTC.');const actions=queue.length?queue:[{kind:'wait',seconds:(target-now)/1000}];preview=game.preview(actions,target);render();message(preview.state.currentTimeUtc<target?'Предпросмотр остановлен в конце плана или на первом событии. Текущая партия не изменилась.':'Это прогноз; текущая партия не изменилась.');});
$('present').onclick=()=>{preview=null;render();};
$('save').onclick=guard(()=>{persist();message('Партия сохранена в этом браузере.');});
function restore(text){game.restore(text);halt();preview=null;queue=[];actionStart=game.current().currentTimeUtc;render();message('Партия восстановлена. Активное действие стоит на паузе.');}
$('restore-local').onclick=guard(()=>{const text=localStorage.getItem('into-the-night-spike-1');if(!text)throw Error('Сохранения в этом браузере нет.');restore(text);});
$('export-save').onclick=guard(()=>download('into-the-night-save.json',game.save()));
$('export-journal').onclick=guard(()=>download('into-the-night-review.json',JSON.stringify(game.journal(),null,2)));
$('import-save').onchange=async e=>{try{const file=e.target.files[0];if(file)restore(await file.text());}catch(err){message('Сохранение не принято: '+uiError(err.message),true);}finally{e.target.value='';}};
$('new-game').onclick=()=>{if(!confirm('Начать новую партию? Текущую можно предварительно сохранить или скачать.'))return;halt();game=new SpikeGame(catalog,scenario);queue=[];preview=null;render();message('Новая партия. Выбирайте любое направление.');};
$('versions').textContent=`${scenario.scenarioId} v${scenario.scenarioVersion} · ${scenario.modelVersions.simulationVersion} · seed ${scenario.seed}`;
addEventListener('pagehide',persist);
render();message('Выберите аэропорт или наземное действие. Планирование не расходует время.');
