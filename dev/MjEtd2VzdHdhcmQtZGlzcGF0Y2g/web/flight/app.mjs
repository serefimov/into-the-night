// SPDX-License-Identifier: GPL-3.0-only
import {FlightController} from './controller.mjs';
import {GlobeView} from './globe.mjs';
const $=id=>document.getElementById(id),integer=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}),decimal=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const time=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const clock=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'});
const tonnes=kg=>decimal.format(kg/1000)+' т';
const duration=ms=>{const minutes=Math.round(ms/60000);return `${Math.floor(minutes/60)} ч ${minutes%60} мин`;};
const phases={departure:'Отправление',cruise:'В полёте',arrival:'Посадка',service:'Обслуживание',refuelling:'Дозаправка перед вылетом',planning:'Выбор следующего аэродрома',won:'Цель достигнута',dead:'Партия завершена'};
const plural=new Intl.PluralRules('ru-RU'),landings=n=>`${n} ${{one:'посадка',few:'посадки',many:'посадок',other:'посадки'}[plural.select(n)]}`;
const reasonNames={fuel_stock:'На текущем аэродроме не хватает топлива для выбранного рейса.',fuel_capacity:'Для выбранного рейса требуется больше ёмкости бака.',fuel_or_reference_reserve:'Не хватает топлива с необходимым резервом.',takeoff_mass:'Превышена взлётная масса.',landing_mass:'После рейса самолёт слишком тяжёлый для посадки.',unverified_airport:'Пригодность полосы для этого самолёта не подтверждена.',ground_fuel:'Не хватает топлива на наземные операции.',solar_indeterminate:'Безопасность не определена. Такой вылет пока нельзя подтвердить.',same_airport:'Самолёт уже на этом аэродроме.',unknown_airport:'Аэродром не найден.',ambiguous_route:'Нельзя однозначно построить этот маршрут.',mission_busy:'Сначала завершится принятый рейс.',mission_won:'Вы добрались до цели.',mission_dead:'Партия завершена.'};
function text(id,value){const el=$(id);if(el.textContent!==value)el.textContent=value;}
async function json(url){const r=await fetch(url);if(!r.ok)throw Error('Не удалось загрузить данные мира');return r.json();}
export let app=null;
export async function createFlightApp(definition,land) {
 const controller=new FlightController(definition),airports=new Map(definition.airports.map(a=>[a.id,a])),statuses=new Map();
 let follow=false,generation=0,planningKey=null,worker=null,lastDraw=0,destroyed=false;
 const globe=new GlobeView($('globe'),$('globe-markers'),land,{onSelect:select,onInteraction:()=>{follow=false;}});
 globe.focus(controller.view.state.position,1);
 try{worker=new Worker(new URL('./forecast-worker.mjs',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(data.generation!==generation||data.error)return;for(const item of data.batch)statuses.set(item.id,item);globe.dirty=true;};worker.onerror=()=>{worker?.terminate();worker=null;};}catch{}
 function scheduleForecasts(){const s=controller.view.state,key=s.phase==='planning'?`${s.utcMs}:${s.flights}`:s.status==='running'?'busy':s.status;
  if(key===planningKey)return;planningKey=key;generation++;statuses.clear();worker?.postMessage({cancel:true});
  if(s.phase==='planning')worker?.postMessage({generation,save:controller.session.save()});
 }
 function select(id){controller.select(id);if(controller.choice&&controller.view.state.phase==='planning')statuses.set(id,{id,allowed:controller.choice.allowed,reasons:controller.choice.reasons});render();}
 function render() {
  scheduleForecasts();const s=controller.view.state,airport=airports.get(controller.selectedId),choice=controller.choice,accepted=controller.activeForecast;
  const forecast=choice?.forecast??(s.activeFlight?.toId===controller.selectedId?accepted:null),busy=s.status==='running'&&s.phase!=='planning';
  const goal=airports.get(definition.targetId),start=airports.get(definition.initial.airportId);text('goal-name',goal.label??goal.name);text('route-name',`${start.label??start.name} → ${goal.label??goal.name}`);text('flight-clock',clock.format(s.utcMs)+' UTC');$('flight-clock').dateTime=new Date(s.utcMs).toISOString();
  text('flight-fuel',tonnes(s.fuelKg)+' топлива');
  text('flight-status',s.status==='won'?`Цель достигнута · ${integer.format(s.distanceKm)} км · ${landings(s.flights)}`:busy?`${phases[s.phase]} · ${controller.playing?'выполняется':'пауза'}`:'Время стоит. Выберите следующую посадку.');
  $('playback').hidden=!busy;text('play-pause',controller.playing?'Пауза':'Продолжить');text('phase-name',phases[s.phase]);
  if(s.activeFlight)$('flight-progress').value=(s.utcMs-s.activeFlight.startUtcMs)/(s.activeFlight.endUtcMs-s.activeFlight.startUtcMs);
  text('destination-title',airport?(airport.label??airport.name):'Куда летим?');text('destination-subtitle',airport?`${airport.iata?airport.iata+' · ':''}${airport.id} · ${airport.country}`:'Выберите аэродром на глобусе.');
  $('empty-card').hidden=!!airport;$('destination-metrics').hidden=!airport;
  if(airport){text('stock-value',tonnes(s.stocks[airport.id]));text('distance-value',forecast?integer.format(forecast.distanceKm)+' км':airport.id===s.airportId?'Вы здесь':'—');
   text('duration-value',forecast?duration(forecast.arrivalUtcMs-forecast.departureUtcMs):'—');text('arrival-value',forecast?time.format(forecast.arrivalUtcMs):'—');
   text('arrival-fuel-value',forecast&&forecast.flight.arrivalFuelKg>=0?tonnes(forecast.flight.arrivalFuelKg):'—');text('end-fuel-value',forecast?.refuelling?tonnes(forecast.refuelling.fuelKg):forecast?.next?tonnes(forecast.next.fuelKg):'—');
  }
  let title='Время стоит, пока вы выбираете.',detail='Метки выбирают аэродром. Кнопка «Полёт» подтверждает вылет.',kind='';
  if(s.status==='won'){title='✓ Цель достигнута';detail=`${integer.format(s.distanceKm)} км позади. Место назначения — ${goal.label??goal.name}.`;kind='safe';}
  else if(busy){title=controller.playing?'Выполняется принятый рейс':'Рейс на паузе';detail='Дозаправка перед вылетом, полёт и обслуживание проходят автоматически. Затем можно выбрать новое назначение.';}
  else if(choice?.allowed){title='✓ Весь переход безопасен';detail=`Заправка перед вылетом, полёт и обслуживание проверены. Завершение — ${time.format(forecast.endUtcMs)} UTC.`;kind='safe';}
  else if(choice){kind='blocked';title=choice.reasons.includes('solar_indeterminate')?'? Безопасность не подтверждена':'× Вылет недоступен';
   detail=choice.reasons.map(r=>r==='sun'?`Солнце на этапе «${phases[choice.forecast.solar.phase]??'полёт'}»${choice.forecast.solar.eventUtcMs!==null?' — '+time.format(choice.forecast.solar.eventUtcMs)+' UTC':''}.`:reasonNames[r]??'Полёт не подтверждён.').join(' ');}
  text('verdict-title',title);text('verdict-detail',detail);$('route-verdict').className='verdict '+kind;
  $('fly').disabled=!choice?.allowed||busy||s.status!=='running';$('fly').setAttribute('aria-label',airport?`Полёт в ${airport.label??airport.name}`:'Полёт');
  $('dispatch-summary').hidden=!forecast;
  text('dispatch-summary',forecast&&forecast.refuelling.neededKg===0?`Дозаправка не нужна · отправление ${time.format(forecast.departureUtcMs)} UTC.`:forecast?`Здесь нужно добавить ${tonnes(forecast.refuelling.neededKg)} · в наличии ${tonnes(s.stocks[forecast.refuelling.airportId])}. ${forecast.refuelling.sufficient?`Дозаправка ${duration(forecast.refuelling.durationSeconds*1000)} · отправление ${time.format(forecast.departureUtcMs)} UTC.`:'Дозаправка не обеспечит рейс.'}`:'');
  text('ground-note','Заправляемся под выбранный рейс с резервом 5 т. После посадки топливо остаётся на складе до следующего выбора.');
  globe.update({airports:definition.airports,state:s,statuses,selectedId:controller.selectedId,targetId:definition.targetId,startId:definition.initial.airportId,forecast:accepted??choice?.forecast,tracks:controller.tracks});globe.draw(s.utcMs);
 }
 $('fly').addEventListener('click',()=>{if(controller.fly()){follow=true;render();}});
 $('play-pause').addEventListener('click',()=>{controller.playing?controller.pause():controller.play();render();});
 $('zoom-in').addEventListener('click',()=>{follow=false;globe.zoom(1.3);});$('zoom-out').addEventListener('click',()=>{follow=false;globe.zoom(1/1.3);});
 $('plane-focus').addEventListener('click',()=>{follow=controller.playing;globe.focus(controller.view.state.position,Math.min(globe.camera.zoom,1.5));});
 $('goal-focus').addEventListener('click',()=>{follow=false;globe.focus(airports.get(definition.targetId),1);});
 function frame(now){if(destroyed)return;if(now-lastDraw>=32){const changed=controller.tick(now);if(changed){if(follow)globe.focus(controller.view.state.position,globe.camera.zoom);render();}if(globe.dirty)globe.draw(controller.view.state.utcMs);lastDraw=now;}requestAnimationFrame(frame);}
 render();requestAnimationFrame(frame);document.body.dataset.ready='true';
 return {controller,globe,select,render,advanceTo(utcMs){controller.advanceTo(utcMs);render();},destroy(){destroyed=true;worker?.terminate();globe.destroy();}};
}
try {
 const [definition,index]=await Promise.all([json(new URL('../../data/runtime/mission.json',import.meta.url)),json(new URL('../../data/geography/land-110m.json',import.meta.url))]);
 if(!Array.isArray(index.parts)||index.parts.some(p=>!/^land-[1-9][0-9]*\.json$/.test(p)))throw Error('Некорректные данные карты');
 const parts=await Promise.all(index.parts.map(p=>json(new URL('../../data/geography/'+p,import.meta.url))));
 app=await createFlightApp(definition,{type:'MultiPolygon',coordinates:parts.flat()});
}catch(error){text('flight-status','Не удалось загрузить мир. Обновите страницу.');text('verdict-detail',error.message);throw error;}
