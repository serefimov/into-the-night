// SPDX-License-Identifier: GPL-3.0-only
import {forecastChapterOne} from '../../dist/core/mission-ground.js';
import {FlightController} from './controller.mjs';
import {FlightPlanningScan} from './planning-scan.mjs';
import {GlobeView} from './globe.mjs';
import {bindSessionMenu} from './session-menu.mjs';
const $=id=>document.getElementById(id),integer=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}),decimal=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const time=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const clock=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'});
const tonnes=kg=>decimal.format(kg/1000)+' т';
const duration=ms=>{const minutes=Math.round(ms/60000);return `${Math.floor(minutes/60)} ч ${minutes%60} мин`;};
const phases={ground_outbound:'Дорога в Академгородок',ground_acquisition:'Получение данных в НГУ',ground_return:'Возвращение к самолёту',waiting:'Ожидание',departure:'Отправление',cruise:'В полёте',arrival:'Посадка',service:'Обслуживание',refuelling:'Дозаправка перед вылетом',planning:'Выбор следующего аэродрома',won:'Цель достигнута',dead:'Партия завершена'};
const plural=new Intl.PluralRules('ru-RU'),landings=n=>`${n} ${{one:'посадка',few:'посадки',many:'посадок',other:'посадки'}[plural.select(n)]}`;
const reasonNames={fuel_stock:'На текущем аэродроме не хватает топлива для выбранного рейса.',fuel_capacity:'Для выбранного рейса требуется больше ёмкости бака.',fuel_or_reference_reserve:'Не хватает топлива с необходимым резервом.',takeoff_mass:'Превышена взлётная масса.',landing_mass:'После рейса самолёт слишком тяжёлый для посадки.',unverified_airport:'Пригодность полосы для этого самолёта не подтверждена.',ground_fuel:'Не хватает топлива на наземные операции.',solar_indeterminate:'Безопасность не определена. Такой вылет пока нельзя подтвердить.',same_airport:'Самолёт уже на этом аэродроме.',unknown_airport:'Аэродром не найден.',ambiguous_route:'Нельзя однозначно построить этот маршрут.',mission_busy:'Сначала завершится принятый рейс.',mission_won:'Вы добрались до цели.',mission_dead:'Партия завершена.',mission_lost:'Маршрут оборвался: доступных перелётов нет.'};
function text(id,value){const el=$(id);if(el.textContent!==value)el.textContent=value;}
async function json(url){const r=await fetch(url);if(!r.ok)throw Error('Не удалось загрузить данные мира');return r.json();}
export let app=null;
export async function createFlightApp(definition,land) {
 const controller=new FlightController(definition),airports=new Map(definition.airports.map(a=>[a.id,a]));
 let follow=false,lastDraw=0,destroyed=false,groundPreviewKey=null,groundPreview=null;
 const globe=new GlobeView($('globe'),$('globe-markers'),land,{onSelect:select,onInteraction:()=>{follow=false;}});
 const planner=new FlightPlanningScan(controller,()=>render()),statuses=planner.statuses;
 const sessionMenu = bindSessionMenu(controller, {onRestore:restoreView, onRestart:restart});
 follow = Boolean(controller.view.state.activeFlight||controller.view.state.activeGround);
 globe.focus(controller.view.state.position,1);

 function restoreView() {
  planner.reset();
  follow = Boolean(controller.view.state.activeFlight||controller.view.state.activeGround);
  globe.focus(controller.view.state.position);
  render();
 }

 function restart() {
  planner.reset();
  controller.restart();
  follow = false;
  globe.focus(controller.view.state.position,1);
  render();
  sessionMenu.restart();
 }

 function renderMissionSummary(state) {
  $('mission-summary').hidden = state.status === 'running';
  if (state.status === 'running') return;

  const goal = airports.get(definition.targetId);
  text('summary-goal',goal.label ?? goal.name);
  text('summary-utc',clock.format(state.utcMs)+' UTC');
  text('summary-duration',duration(state.utcMs-state.startUtcMs));
  text('summary-distance',integer.format(state.distanceKm)+' км');
  text('summary-landings',landings(state.flights));
  text('summary-fuel',tonnes(state.fuelKg));
  const visited = [definition.initial.airportId,
   ...controller.view.events.filter(event=>event.kind==='arrived').map(event=>event.airportId)];
  const stops = visited.map(id=>{
   const item = document.createElement('li');
   const airport = airports.get(id);
   item.textContent = airport.label ?? airport.name;
   return item;
  });
  $('summary-route').replaceChildren(...stops);
 }
 function renderAvailability(s){
  const waitingCount=[...statuses.values()].filter(v=>v.window?.status==='waiting').length;
  const report=planner.summary(),terminal=s.status!=='running',busy=s.status==='running'&&s.phase!=='planning';
  let title='',detail='',kind='';
  if(s.status==='won'){title='Цель достигнута';detail=`${integer.format(s.distanceKm)} км · ${landings(s.flights)} · ${time.format(s.utcMs)} UTC.`;kind='safe';}
  else if(s.status==='dead'){title='Поражение: самолёт встретил Солнце';detail=`Солнце в текущей точке — ${time.format(s.death.utcMs)} UTC.`;kind='blocked';}
  else if(s.status==='lost'){title='Поражение: маршрут оборвался';detail=`Нет доступных перелётов. Проверены все ${s.result.total} направления текущего каталога. Ожидание не устраняет подтверждённые постоянные ограничения этих направлений.`;kind='blocked';}
  else if(s.activeGround){title=controller.playing?'Экспедиция выполняется':'Экспедиция на паузе';detail='Группа в пути, самолёт в Толмачёво. Свет проверен вдоль всей дороги и в НГУ.';}
  else if(busy){title=s.phase==='waiting'?(controller.playing?'Ожидание выполняется':'Ожидание на паузе'):controller.playing?'Рейс выполняется':'Рейс на паузе';detail=s.phase==='waiting'?'Можно поставить ожидание на паузу или остановить его. Полёт подтверждается отдельно.':'Следующие направления проверим после завершения полёта и обслуживания.';}
  else {
   if(report.availableIds.length){title=`Доступно перелётов: ${report.availableIds.length}`;kind='safe';}
   else if(waitingCount){title=`Есть перелёты после ожидания: ${waitingCount}`;kind='safe';}
   else if(report.status==='unresolved')title='Безопасность ещё не определена';
   else if(report.status==='failed')title='Проверка не завершена';
   else if(report.status==='no_safe_choices')title='Сейчас нет доступных перелётов';
   else title='Проверяем направления';
   detail=`Проверено ${report.checked} из ${report.total} · осталось ${report.remaining}.`;
   if(report.unresolvedIds.length)detail+=` Требуют уточнения: ${report.unresolvedIds.length}. Поражение не подтверждено.`;
   if(report.status==='failed')detail+=' Проверку всего каталога завершить не удалось. Партия продолжается.';

  }
  text('availability-scope',terminal?'Итог партии':s.activeGround?'Академгородок':busy?(s.phase==='waiting'?'Ожидание':'Выполнение рейса'):'По всему каталогу');
  text('availability-title',title);text('availability-detail',detail+(s.phase==='planning'?` Окна: ${planner.windowsChecked} из ${planner.windowsTotal||report.total}; после ожидания — ${waitingCount}.`:''));$('availability-panel').className='availability-panel '+kind+(terminal?' terminal':'');
  const names={airport:'Полосы',mass:'Масса',fuel:'Топливо',sun:'Солнце',geometry:'Геометрия'},reasons=s.result?.kind==='no_routes'?Object.entries(s.result.reasons).filter(([,n])=>n>0).map(([key,n])=>`${names[key]}: ${n}`).join(' · '):'';
  text('availability-reasons',reasons);$('availability-reasons').hidden=!reasons;
  $('restart-mission').hidden=!terminal;$('retry-scan').hidden=terminal||busy||!['failed','unresolved'].includes(report.status);
 }
 function renderCampaign(s,flightForecast) {
  const d=definition.chapterOne;
  $('campaign-panel').hidden=!d;if(!d)return;
  text('knowledge-count',String(s.campaign.knowledgeIds.length));
  text('campaign-objective',s.campaign.chapterOneCompleted?'Глава 1 завершена · дальше — Цукуба за наводкой':'Знание №1 · научный архив НГУ');
  text('campaign-location',s.activeGround?`${phases[s.phase]}. Самолёт оставлен в Толмачёво. Взлёт после возвращения.`:s.campaign.chapterOneCompleted?'Первая часть получена. Выберите следующий безопасный перелёт.':s.airportId===d.airportId?'Вы в Толмачёво. Данные нужно забрать в Академгородке и вернуться.':'Свет смертелен. Первая часть данных находится в Академгородке; доберитесь через запад.');
  const shown=s.activeGround||!s.campaign.chapterOneCompleted&&(controller.selectedId===d.airportId||s.airportId===d.airportId);
  $('expedition-card').hidden=!shown;$('expedition-start').hidden=!(s.phase==='planning'&&s.airportId===d.airportId&&!s.campaign.chapterOneCompleted);
  if(!shown)return;
  text('expedition-budget',`Дорога ${duration(d.outboundSeconds*1000)} · данные ${duration(d.acquisitionSeconds*1000)} · обратно ${duration(d.returnSeconds*1000)}. Обычная машина и здание не защищают от света.`);
  const start=s.activeGround?.startUtcMs??(s.airportId===d.airportId?s.utcMs:flightForecast?.endUtcMs);
  if(start!==undefined){
   const key=String(start);if(key!==groundPreviewKey){groundPreviewKey=key;groundPreview=forecastChapterOne(d,start);}
  }else groundPreview=null;
  const f=groundPreview;
  $('expedition-start').disabled=!f?.allowed;
  text('expedition-verdict',s.activeGround?`${phases[s.phase]} · ${controller.playing?'выполняется':'пауза'}`:f?.allowed?'✓ Ночи хватает на весь путь и получение данных':f?'× Ночи не хватает на безопасную экспедицию':'Сначала нужен расчёт безопасного перелёта.');
  $('expedition-verdict').className=f?.allowed?'safe':'blocked';
  const problem=f&&!f.allowed?(f.solar.status==='unsafe'?`Солнце: ${phases[f.solar.stage]} — ${clock.format(f.solar.witnessUtcMs)} UTC.`:f.parkedSolar.status==='unsafe'?'Оставленный самолёт встретит Солнце.':'Безопасность требует уточнения.'):'Полный путь, место получения, последний UTC и стоянка самолёта проверены.';
  text('expedition-times',f?`После обслуживания: ${clock.format(f.startUtcMs)} UTC. Данные: ${clock.format(f.acquiredUtcMs)} UTC. У самолёта: ${clock.format(f.endUtcMs)} UTC. ${problem}`:'');
  text('expedition-margin',f?`${f.returnMarginSeconds===null?'Запас до рассвета у самолёта не определён.':f.returnMarginSeconds>=0?`После возвращения до рассвета у самолёта: ${duration(f.returnMarginSeconds*1000)}.`:`Возвращение позже рассвета у самолёта на ${duration(-f.returnMarginSeconds*1000)}.`} Рассвет НГУ: ${f.siteSunriseUtcMs===null?'не определён':clock.format(f.siteSunriseUtcMs)+' UTC'}. Следующий рейс проверяется отдельно.`:'');
 }
 function select(id){controller.select(id);planner.prioritize(id);if(controller.view.state.phase==='planning')planner.record(id,controller.choice);render();}
 function render() {
  planner.update();const s=controller.view.state,airport=airports.get(controller.selectedId),choice=controller.choice,accepted=controller.activeForecast;
  const window=statuses.get(controller.selectedId)?.window;
  const forecast=(window?.status==='waiting'?window.forecast:choice?.forecast)??(s.activeFlight?.toId===controller.selectedId?accepted:null),busy=s.status==='running'&&s.phase!=='planning';
  renderAvailability(s);
  renderCampaign(s,forecast);
  renderMissionSummary(s);
  const goal=airports.get(definition.targetId),start=airports.get(definition.initial.airportId);text('goal-name',definition.chapterOne?'Академгородок':goal.label??goal.name);text('route-name',`${start.label??start.name} → ${goal.label??goal.name}`);text('flight-clock',clock.format(s.utcMs)+' UTC');$('flight-clock').dateTime=new Date(s.utcMs).toISOString();
  text('flight-fuel',tonnes(s.fuelKg)+' топлива');
  text('flight-status',s.status==='lost'?'Маршрут оборвался: нет доступных перелётов.':s.status==='dead'?'Партия завершена: самолёт встретил Солнце.':s.status==='won'?`Цель достигнута · ${integer.format(s.distanceKm)} км · ${landings(s.flights)}`:busy?`${phases[s.phase]} · ${controller.playing?'выполняется':'пауза'}`:'Время стоит. Выберите следующую посадку.');
  $('playback').hidden=!busy;$('flight-progress').setAttribute('aria-label',s.activeGround?'Ход экспедиции':s.activeWait?'Ход ожидания':'Ход принятого перелёта');text('play-pause',controller.playing?'Пауза':'Продолжить');text('phase-name',phases[s.phase]);
  if(s.activeGround)$('flight-progress').value=(s.utcMs-s.activeGround.startUtcMs)/(s.activeGround.endUtcMs-s.activeGround.startUtcMs);
  if(s.activeWait)$('flight-progress').value=(s.utcMs-s.activeWait.startUtcMs)/(s.activeWait.endUtcMs-s.activeWait.startUtcMs);
  if(s.activeFlight)$('flight-progress').value=(s.utcMs-s.activeFlight.startUtcMs)/(s.activeFlight.endUtcMs-s.activeFlight.startUtcMs);
  text('destination-title',airport?(airport.label??airport.name):'Куда летим?');text('destination-subtitle',airport?`${airport.iata?airport.iata+' · ':''}${airport.id} · ${airport.country}`:'Выберите аэродром на глобусе.');
  $('empty-card').hidden=!!airport;$('destination-metrics').hidden=!airport;
  if(airport){text('stock-value',tonnes(s.stocks[airport.id]));text('distance-value',forecast?integer.format(forecast.distanceKm)+' км':airport.id===s.airportId?'Вы здесь':'—');
   text('duration-value',forecast?duration(forecast.arrivalUtcMs-forecast.departureUtcMs):'—');text('arrival-value',forecast?time.format(forecast.arrivalUtcMs):'—');
   text('arrival-fuel-value',forecast&&forecast.flight.arrivalFuelKg>=0?tonnes(forecast.flight.arrivalFuelKg):'—');text('end-fuel-value',forecast?.refuelling?tonnes(forecast.refuelling.fuelKg):forecast?.next?tonnes(forecast.next.fuelKg):'—');
  }
  let title='Время стоит, пока вы выбираете.',detail='Метки выбирают аэродром. Кнопка «Полёт» подтверждает вылет.',kind='';
  if(s.status==='won'){title='✓ Цель достигнута';detail=`${integer.format(s.distanceKm)} км позади. Место назначения — ${goal.label??goal.name}.`;kind='safe';}
  else if(busy&&s.phase==='waiting'){title=controller.playing?'Ожидание выполняется':'Ожидание на паузе';detail=`Ждём до ${clock.format(s.activeWait.endUtcMs)} UTC. После ожидания полёт подтверждается отдельно.`;}
  else if(busy){title=controller.playing?'Выполняется принятый рейс':'Рейс на паузе';detail='Дозаправка перед вылетом, полёт и обслуживание проходят автоматически. Затем можно выбрать новое назначение.';}
  else if(choice?.allowed){title='✓ Весь переход безопасен';detail=`Заправка перед вылетом, полёт и обслуживание проверены. Завершение — ${time.format(forecast.endUtcMs)} UTC.`;kind='safe';}
  else if(choice){kind='blocked';title=choice.reasons.includes('solar_indeterminate')?'? Безопасность не подтверждена':'× Вылет недоступен';
   detail=choice.reasons.map(r=>r==='sun'?`Солнце на этапе «${phases[choice.forecast.solar.phase]??'полёт'}»${choice.forecast.solar.eventUtcMs!==null?' — '+time.format(choice.forecast.solar.eventUtcMs)+' UTC':''}.`:reasonNames[r]??'Полёт не подтверждён.').join(' ');}
  if(!busy&&window?.status==='waiting'){
   title='◷ Доступно после ожидания';kind='safe';
   detail=(choice?.reasons.includes('sun')?'Сейчас переход блокирует Солнце.':'Сейчас безопасность перехода не подтверждена.')+' Стоянка и весь будущий переход проверены. После ожидания нажмите «Полёт» отдельно.';
  }
  $('fly').hidden=!busy&&window?.status==='waiting'&&!choice?.allowed;
  $('wait-departure').hidden=busy||s.status!=='running'||window?.status!=='waiting';
  $('stop-wait').hidden=s.phase!=='waiting';
  $('window-detail').hidden=!airport||airport.id===s.airportId||busy||choice?.allowed;
  let windowText=planner.summary().status==='failed'?'Поиск окна не завершён. Повторите проверку.':'Поиск безопасного окна… Время стоит.';
  if(window?.status==='waiting')windowText=`Ожидание ${duration(window.startUtcMs-s.utcMs)} · начало перехода ${clock.format(window.startUtcMs)} UTC · вылет ${clock.format(window.forecast.departureUtcMs)} UTC · прибытие ${time.format(window.forecast.arrivalUtcMs)} UTC. Первое подтверждённое время на сетке 15 минут; более узкие окна могут быть пропущены.${window.earlierUncertain?' Более ранние варианты требуют уточнения.':''}`;
  if(window?.status==='blocked')windowText='Ожидание не устраняет ограничения этого направления.';
  if(window?.status==='not_found')windowText=window.limit==='range'?'Поиск ограничен поддерживаемым диапазоном UTC.':window.limit==='sunrise'?'Безопасное окно не найдено до солнечной границы стоянки.':'Окно не найдено в пределах 24 часов на сетке 15 минут. Это не доказательство невозможности будущего рейса.';
  if(window?.status==='indeterminate')windowText='Поиск окна ограничен или безопасность требует уточнения. Ожидание не разрешено.';
  text('window-detail',windowText);
  text('verdict-title',title);text('verdict-detail',detail);$('route-verdict').className='verdict '+kind;
  $('flight-planning-card').hidden=s.status!=='running'||!!s.activeGround;
  $('plane-focus').setAttribute('aria-label',s.activeGround?'Центрировать на группе':'Центрировать на самолёте');
  $('plane-focus').title=s.activeGround?'Центрировать на текущей позиции группы':'Центрировать на текущей позиции самолёта';
  $('fly').disabled=!choice?.allowed||busy||s.status!=='running';$('fly').setAttribute('aria-label',airport?`Полёт в ${airport.label??airport.name}`:'Полёт');
  $('dispatch-summary').hidden=!forecast;
  text('dispatch-summary',forecast&&forecast.refuelling.neededKg===0?`Дозаправка не нужна · отправление ${time.format(forecast.departureUtcMs)} UTC.`:forecast?`Здесь нужно добавить ${tonnes(forecast.refuelling.neededKg)} · в наличии ${tonnes(s.stocks[forecast.refuelling.airportId])}. ${forecast.refuelling.sufficient?`Дозаправка ${duration(forecast.refuelling.durationSeconds*1000)} · отправление ${time.format(forecast.departureUtcMs)} UTC.`:'Дозаправка не обеспечит рейс.'}`:'');
  text('ground-note','Заправляемся под выбранный рейс с резервом 5 т. После посадки топливо остаётся на складе до следующего выбора.');
  globe.update({airports:definition.airports,state:s,statuses,selectedId:controller.selectedId,targetId:definition.targetId,startId:definition.initial.airportId,forecast:accepted??forecast,acceptedForecast:accepted,tracks:controller.tracks});globe.draw(s.utcMs);
  if (s.status !== 'running') sessionMenu.checkpoint(performance.now(),true);
 }
 $('expedition-start').addEventListener('click',()=>{if(!controller.startExpedition().allowed)return;follow=true;planner.reset();render();sessionMenu.checkpoint(performance.now(),true);});
 $('restart-mission').addEventListener('click',restart);
 $('retry-scan').addEventListener('click',()=>planner.retry());
 $('fly').addEventListener('click',()=>{
  if (!controller.fly()) return;
  follow = true;
  render();
  sessionMenu.checkpoint(performance.now(),true);
 });
 $('wait-departure').addEventListener('click',()=>{
  const window=statuses.get(controller.selectedId)?.window;
  if(window?.status!=='waiting'||!controller.waitForDeparture(window.startUtcMs))return;
  planner.reset();render();sessionMenu.checkpoint(performance.now(),true);
 });
 $('stop-wait').addEventListener('click',()=>{controller.cancelWait();planner.reset();render();sessionMenu.checkpoint(performance.now(),true);});
 $('play-pause').addEventListener('click',()=>{
  controller.playing ? controller.pause() : controller.play();
  render();
  sessionMenu.checkpoint(performance.now(),true);
 });
 $('zoom-in').addEventListener('click',()=>{follow=false;globe.zoom(1.3);});$('zoom-out').addEventListener('click',()=>{follow=false;globe.zoom(1/1.3);});
 $('plane-focus').addEventListener('click',()=>{follow=true;globe.focus(controller.view.state.position);});
 $('goal-focus').addEventListener('click',()=>{follow=false;globe.focus(airports.get(definition.targetId),1);});
 function frame(now) {
  if (destroyed) return;
  if (now-lastDraw>=32) {
   if (controller.tick(now)) {
    if (follow) globe.focus(controller.view.state.position);
    render();
    sessionMenu.checkpoint(now,!controller.playing);
   }
   if (globe.dirty) globe.draw(controller.view.state.utcMs);
   lastDraw = now;
  }
  requestAnimationFrame(frame);
 }
 render();requestAnimationFrame(frame);document.body.dataset.ready='true';
 return {
  controller,globe,planner,select,render,
  advanceTo(utcMs) {
   controller.advanceTo(utcMs);
   render();
   sessionMenu.checkpoint(performance.now(),true);
  },
  destroy() {
   destroyed = true;
   planner.destroy();
   globe.destroy();
   sessionMenu.destroy();
  },
 };
}
try {
 const [definition,index]=await Promise.all([json(new URL(new URLSearchParams(location.search).get('scenario')==='airport-spike'?'../../data/runtime/airport-spike.json':'../../data/runtime/mission.json',import.meta.url)),json(new URL('../../data/geography/land-50m.json',import.meta.url))]);
 if(!Array.isArray(index.parts)||index.parts.some(p=>!/^coast-50m-[1-9][0-9]*\.json$/.test(p)))throw Error('Некорректные данные карты');
 const parts=await Promise.all(index.parts.map(p=>json(new URL('../../data/geography/'+p,import.meta.url))));
 app=await createFlightApp(definition,{type:'MultiPolygon',coordinates:parts.flat()});
}catch(error){text('flight-status','Не удалось загрузить мир. Обновите страницу.');text('verdict-detail',error.message);throw error;}
