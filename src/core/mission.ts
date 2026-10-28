// SPDX-License-Identifier: GPL-3.0-only
import {forecastChapterOne,validateChapterOne} from './mission-ground.js';
import type {GroundForecast,GroundStage} from './mission-ground.js';
import {validateResearchState} from './mission-research.js';
import {forecastMissionFlight} from './mission-flight.js';
import type {MissionWorld,MissionForecast} from './mission-flight.js';
import type {ResearchState,ResearchPhase} from './mission-research.js';
import {aircraftMetrics} from './aircraft.js';
import {routePhasePosition} from './route.js';
import {solarExposure,validateCoordinates} from './solar.js';
import type {Coordinates} from './solar.js';
import {searchLimits} from './interval-search.js';
import type {SearchOptions} from './interval-search.js';
import {validateUtcMs} from './time.js';
import {MissionAvailabilityScan,inactiveAvailability} from './mission-availability.js';
import type {MissionAvailability,AvailabilityReason,AvailabilityChoice} from './mission-availability.js';
import {canonicalJson,saveChecksum} from './serialization.js';
import {searchStationarySunrise} from './waiting.js';
import {departureWindowSteps} from './departure-window.js';
import {forecastMissionWait} from './mission-wait.js';

export const MISSION_MODEL=Object.freeze({mode:'airport-flight-v3',simulationVersion:'flight-cycle-3',schemaVersion:3,eventVersion:3,saveVersion:5,waitingVersion:1} as const);
export const CAMPAIGN_MODEL=Object.freeze({mode:'campaign-ground-v1',simulationVersion:'flight-ground-1',schemaVersion:4,eventVersion:4,saveVersion:6} as const);
export interface MissionDefinition extends MissionWorld {
 scenarioId:string; scenarioVersion:number; seed:string; stockVersion:string; worldVersion:string;
 targetCompletion:'arrival'|'after_service';
 initial:{airportId:string; utcMs:number; fuelKg:number; stocks:Record<string,number>};
}
export interface MissionEvent {
 version:3|4; sequence:number; utcMs:number; flightIndex:number; airportId:string;
 kind:'mission_started'|'flight_committed'|'flight_started'|'arrived'|'refuelling_started'|'flight_completed'|'mission_won'|'mission_died'|'mission_lost'|'waiting_started'|'waiting_completed'|'expedition_started'|'knowledge_acquired'|'chapter_completed';
}
export interface MissionState {
 mode:typeof MISSION_MODEL.mode|typeof CAMPAIGN_MODEL.mode; schemaVersion:3|4; simulationVersion:string; scenarioId:string; scenarioVersion:number; seed:string; stockVersion:string; worldVersion:string;
 startUtcMs:number; utcMs:number; airportId:string|null; position:Coordinates; fuelKg:number; stocks:Record<string,number>;
 flights:number; distanceKm:number; status:'running'|'won'|'dead'|'lost';
 phase:GroundStage|'waiting'|'planning'|'won'|'dead'|'lost'|ResearchPhase['label']; death:null|{kind:'sun';utcMs:number};
 result:MissionResult|null;
 campaign?:{chapterOneCompleted:boolean;knowledgeIds:('akademgorodok')[];objective:'akademgorodok'|'tsukuba';playerLocation:'aircraft'|'ground'};
 aircraft?:{airportId:string|null;position:Coordinates};
 activeGround?:{startUtcMs:number;acquiredUtcMs:number;endUtcMs:number;stage:GroundStage};
 activeWait?:{startUtcMs:number;endUtcMs:number};
 activeFlight:null|{fromId:string;toId:string;startUtcMs:number;departureUtcMs:number;arrivalUtcMs:number;endUtcMs:number;phaseStartUtcMs:number;phaseEndUtcMs:number};
}
export type MissionResult={kind:'goal'|'sun';utcMs:number}|{kind:'no_routes';utcMs:number;checked:number;total:number;reasons:Record<AvailabilityReason,number>};
export interface MissionView {state:MissionState;events:MissionEvent[]}
export interface MissionAdvance extends MissionView {newEvents:MissionEvent[]}
export interface MissionChoice {allowed:boolean; reasons:readonly string[]; forecast:MissionForecast|null}
interface AcceptedFlight {origin:ResearchState;toId:string;forecast:MissionForecast}
interface AcceptedWait {origin:ResearchState;waitUntil:number;requestedUntil:number;destinationId?:string;forecast:{endUtcMs:number;next:ResearchState}}
interface AcceptedGround {origin:ResearchState;expedition:true;forecast:GroundForecast&{next:ResearchState}}
type AcceptedPlan=AcceptedFlight|AcceptedWait|AcceptedGround;
export interface GroundChoice {allowed:boolean;reasons:readonly string[];forecast:GroundForecast|null}
export interface MissionAcceptedFlight {fromId:string;toId:string;forecast:MissionForecast}
interface MissionPayload {
 mode:string;simulationVersion:string;eventVersion:number;definition:MissionDefinition;options:SearchOptions;
 choices:(string|{expedition:true}|{waitUntil:number;stopUtcMs:number;destinationId?:string})[];noRoutesAt:number|null;cursorUtcMs:number;consumedEvents:number;snapshot:MissionView;
}
function copy<T>(value:T):T {
 if(Array.isArray(value))return value.map(copy) as T;
 if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copy(v)])) as T;
 return value;
}
/** Chrome and Node can disagree in the final digits of physical metrics.
 * Only snapshot comparison uses these absolute bounds: kg/km 1e-9, degrees 1e-10.
 * UTC, events, versions and all simulation/safety decisions remain exact. */
function matchesSnapshot(stored:MissionView,actual:MissionView):boolean {
 if (!stored?.state?.position || !stored.state.stocks) return false;
 const normalized = copy(stored);
 const near = (a:unknown,b:number,tolerance:number) =>
  typeof a === 'number' && Number.isFinite(a) && Math.abs(a-b) <= tolerance;

 for (const key of ['fuelKg','distanceKm'] as const) {
  if (!near(stored.state[key],actual.state[key],1e-9)) return false;
  normalized.state[key] = actual.state[key];
 }
 for (const key of ['latitudeDeg','longitudeDeg'] as const) {
  if (!near(stored.state.position[key],actual.state.position[key],1e-10)) return false;
  normalized.state.position[key] = actual.state.position[key];
 }
 if(actual.state.aircraft){
  if(!stored.state.aircraft)return false;
  for(const key of ['latitudeDeg','longitudeDeg'] as const){
   if(!near(stored.state.aircraft.position[key],actual.state.aircraft.position[key],1e-10))return false;
   normalized.state.aircraft!.position[key]=actual.state.aircraft.position[key];
  }
 }
 for (const [id,fuel] of Object.entries(actual.state.stocks)) {
  if (!near(stored.state.stocks[id],fuel,1e-9)) return false;
  normalized.state.stocks[id] = fuel;
 }
 return canonicalJson(normalized) === canonicalJson(actual);
}
function initialResearch(d:MissionDefinition):ResearchState {return {...copy(d.initial),flights:0,distanceKm:0,won:false};}
function validateDefinition(d:MissionDefinition):void {
 canonicalJson(d);
 for(const key of ['scenarioId','seed','stockVersion','worldVersion'] as const)if(typeof d[key]!=='string'||!d[key])throw new RangeError('Missing mission '+key);
 if(!Number.isInteger(d.scenarioVersion)||d.scenarioVersion<1||!['arrival','after_service'].includes(d.targetCompletion))throw new RangeError('Invalid mission version or completion');
 if(!Array.isArray(d.airports)||d.airports.length<2)throw new RangeError('Mission needs airports');
 const ids=new Set<string>();
 for(const a of d.airports){validateCoordinates(a);if(typeof a.id!=='string'||!a.id||ids.has(a.id)||!['screened-candidate','unverified'].includes(a.suitability.status))throw new RangeError('Invalid mission airport');ids.add(a.id);}
 if(Object.keys(d.initial.stocks).length!==ids.size||Object.keys(d.initial.stocks).some(id=>!ids.has(id))||d.initial.airportId===d.targetId||d.airports.find(a=>a.id===d.initial.airportId)?.suitability.status!=='screened-candidate')throw new RangeError('Invalid mission stock coverage or endpoints');
 if(d.chapterOne){const a=d.airports.find(a=>a.id===d.chapterOne!.airportId);if(!a||d.targetId!==a.id)throw new RangeError('Invalid expedition airport');validateChapterOne(d.chapterOne,a);}
 validateResearchState({profile:d.profile,airports:d.airports,targetId:d.targetId},initialResearch(d));
}
function validateOptions(options:SearchOptions):void {
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['eventToleranceSeconds','maxIntervalSeconds','maxEvaluations'].includes(k)))throw new RangeError('Invalid mission search options');
 searchLimits(options);
}
/** A food-free session with explicitly certified parked waits. The shared departure-fuel transition supplies every accepted physical plan. */
export class MissionSession {
 #definition:MissionDefinition; #options:SearchOptions; #initial:ResearchState; #plans:AcceptedPlan[]=[];
 #cursor:number; #consumedEvents=0; #initialSun:boolean; #definitionHash:string; #noRoutes:null|{utcMs:number;report:MissionAvailability}=null;
 constructor(definition:MissionDefinition,options:SearchOptions={}) {
  this.#definition=copy(definition);this.#options=copy(options);validateDefinition(this.#definition);validateOptions(this.#options);
  this.#definitionHash=saveChecksum(this.#definition);
  this.#initial=initialResearch(this.#definition);this.#cursor=this.#initial.utcMs;
  this.#initialSun=!solarExposure(this.#airport(this.#initial.airportId),this.#cursor).safe;
 }
 get model(){return this.#definition.chapterOne?CAMPAIGN_MODEL:MISSION_MODEL;}
 get definition():MissionDefinition{return copy(this.#definition);}
 get currentTimeUtc():number{return this.#cursor;}
 /** Read-only-by-copy accepted plans, for presenting history and resuming playback. */
 get acceptedFlights():MissionAcceptedFlight[] {
  return this.#plans.filter((p):p is AcceptedFlight=>'toId' in p).map(plan=>({fromId:plan.origin.airportId,toId:plan.toId,forecast:copy(plan.forecast)}));
 }
 get endUtcMs():number{return this.#plans.at(-1)?.forecast.endUtcMs??this.#initial.utcMs;}
 get planningKey():string|null {const state=this.current().state;return state.status==='running'&&state.phase==='planning'?saveChecksum({definition:this.#definitionHash,options:this.#options,state:this.#ready()}):null;}
 #airport(id:string) {return this.#definition.airports.find(a=>a.id===id)!;}
 #ready():ResearchState {return this.#plans.at(-1)?.forecast.next??this.#initial;}
 forecastExpedition():GroundChoice {
  const state=this.current().state,d=this.#definition.chapterOne;
  const blocked=(reason:string):GroundChoice=>({allowed:false,reasons:[reason],forecast:null});
  if(!d)return blocked('no_expedition');
  if(state.status!=='running')return blocked('mission_'+state.status);
  if(state.phase!=='planning')return blocked('mission_busy');
  if(state.campaign!.chapterOneCompleted)return blocked('expedition_completed');
  if(state.airportId!==d.airportId)return blocked('expedition_airport');
  const forecast=forecastChapterOne(d,state.utcMs,this.#options);
  return {allowed:forecast.allowed,reasons:forecast.reasons,forecast};
 }
 startExpedition():GroundChoice {
  const choice=this.forecastExpedition();
  if(choice.allowed){const origin=copy(this.#ready());this.#plans.push({origin,expedition:true,forecast:{...copy(choice.forecast!),next:{...copy(origin),utcMs:choice.forecast!.endUtcMs}}});}
  return choice;
 }
 waitingLimit() {
  const state=this.current().state;
  if(state.status!=='running'||state.phase!=='planning')throw new RangeError('Mission is not planning');
  return searchStationarySunrise(state.position,state.utcMs,this.#options);
 }
 /** Read-only solar certification; accepting and executing a wait is separate. */
 forecastWait(endUtcMs:number) {
  const state=this.current().state;
  if(state.status!=='running'||state.phase!=='planning')throw new RangeError('Mission is not planning');
  return forecastMissionWait({position:state.position,startUtcMs:state.utcMs,endUtcMs},this.#options);
 }
 departureWindowSteps(destinationId:string) {
  let immediate:MissionChoice;
  try{immediate=this.forecast(destinationId);}
  catch(error){
   if(!(error instanceof RangeError)||!error.message.startsWith('UTC must'))throw error;
   immediate={allowed:false,reasons:['simulation_horizon'],forecast:null};
  }
  return departureWindowSteps(this.#definition,copy(this.#ready()),destinationId,immediate,this.#options);
 }
 departureWindow(destinationId:string) {
  const steps=this.departureWindowSteps(destinationId);
  let step=steps.next();while(!step.done)step=steps.next();return step.value;
 }
 get waitingDestinationId():string|null {
  const last=this.#plans.at(-1);return last&&'waitUntil' in last?last.destinationId??null:null;
 }
 waitForDeparture(destinationId:string,startUtcMs:number) {
  const standing=this.forecastWait(startUtcMs);
  if(standing.status!=='safe')return false;
  const flight=forecastMissionFlight(this.#definition,{...copy(this.#ready()),utcMs:startUtcMs},destinationId,this.#options);
  if(!flight.allowed)return false;
  this.#acceptWait(startUtcMs).destinationId=destinationId;
  return true;
 }
 /** Accept only an entirely certified interval. No resources change on a parked wait. */
 waitUntil(endUtcMs:number) {
  const forecast=this.forecastWait(endUtcMs);
  if(forecast.status==='safe')this.#acceptWait(endUtcMs);
  return forecast;
 }
 #acceptWait(endUtcMs:number):AcceptedWait {
  const origin=copy(this.#ready());
  const plan:AcceptedWait={origin,waitUntil:endUtcMs,requestedUntil:endUtcMs,
   forecast:{endUtcMs,next:{...copy(origin),utcMs:endUtcMs}}};
  this.#plans.push(plan);return plan;
 }
 /** End a wait at the actual cursor; the discarded remainder is not executed. */
 cancelWait():MissionAdvance {
  const state=this.current().state,last=this.#plans.at(-1);
  if(state.phase!=='waiting'||!last||!('waitUntil' in last))throw new RangeError('Mission is not waiting');
  last.waitUntil=this.#cursor;last.forecast={endUtcMs:this.#cursor,next:{...copy(last.origin),utcMs:this.#cursor}};
  return this.stopAt(this.#cursor);
 }
 forecast(destinationId:string):MissionChoice {
  const view=this.current().state;
  const blocked=(reason:string):MissionChoice=>({allowed:false,reasons:[reason],forecast:null});
  if(view.status!=='running')return blocked('mission_'+view.status);
  if(view.phase!=='planning')return blocked('mission_busy');
  if(!this.#definition.airports.some(a=>a.id===destinationId))return blocked('unknown_airport');
  if(destinationId===view.airportId)return blocked('same_airport');
  return this.#forecastReady(destinationId);
 }
 #forecastReady(destinationId:string):MissionChoice {
  const blocked=(reason:string):MissionChoice=>({allowed:false,reasons:[reason],forecast:null});
  try {const forecast=forecastMissionFlight(this.#definition,this.#ready(),destinationId,this.#options);return {allowed:forecast.allowed,reasons:forecast.reasons,forecast};}
  catch(error){if(error instanceof RangeError&&/Coincident|antipodal/.test(error.message))return blocked('ambiguous_route');throw error;}
 }
 fly(destinationId:string):MissionChoice {
  const choice=this.forecast(destinationId);
  if(choice.allowed)this.#plans.push({origin:copy(this.#ready()),toId:destinationId,forecast:copy(choice.forecast!)});
  return choice;
 }
 /** Pure, complete analysis: it never changes time, resources, result or event delivery. */
 availability():MissionAvailability {
  if(this.#noRoutes)return copy(this.#noRoutes.report);
  const state=this.current().state;
  if(state.status!=='running')return inactiveAvailability('terminal');
  if(state.phase!=='planning')return inactiveAvailability('busy');
  const ids=this.#definition.airports.filter(a=>a.id!==state.airportId).map(a=>a.id);
  const scan=new MissionAvailabilityScan(this.planningKey!,ids);
  const choices:AvailabilityChoice[]=[];
  try{for(const id of ids){const f=this.#forecastReady(id);choices.push({id,allowed:f.allowed,reasons:f.reasons});}}
  catch{scan.accept(scan.key,choices);scan.fail();return scan.summary();}
  scan.accept(scan.key,choices,true);return scan.summary();
 }
 /** Only the session's own full-catalog forecasts can commit a no-routes result.
  * Worker counts are progress, never authority to end a party. Only time-independent blocks establish a dead end without departure-window analysis. */
 resolvePlanning():MissionAdvance&{availability:MissionAvailability} {
  const availability=this.availability();
  if(!(this.#definition.chapterOne&&this.current().state.airportId===this.#definition.chapterOne.airportId&&!this.current().state.campaign?.chapterOneCompleted)&&!this.#noRoutes&&this.current().state.phase==='planning'&&availability.status==='no_safe_choices'&&availability.complete&&availability.reasons.sun===0){
   this.#noRoutes={utcMs:this.#cursor,report:copy(availability)};
   return {...this.stopAt(this.#cursor),availability};
  }
  return {...this.current(),newEvents:[],availability};
 }
 #events():MissionEvent[] {
  const events:MissionEvent[]=[];
  const append=(kind:MissionEvent['kind'],utcMs:number,flightIndex:number,airportId:string)=>events.push({version:this.model.eventVersion,sequence:events.length,kind,utcMs,flightIndex,airportId});
  append('mission_started',this.#initial.utcMs,0,this.#initial.airportId);
  if(this.#initialSun)append('mission_died',this.#initial.utcMs,0,this.#initial.airportId);
  for(const plan of this.#plans){
   if('expedition' in plan){append('expedition_started',plan.origin.utcMs,plan.origin.flights,plan.origin.airportId);append('knowledge_acquired',plan.forecast.acquiredUtcMs,plan.origin.flights,plan.origin.airportId);append('chapter_completed',plan.forecast.endUtcMs,plan.origin.flights,plan.origin.airportId);continue;}
   if('waitUntil' in plan){append('waiting_started',plan.origin.utcMs,plan.origin.flights,plan.origin.airportId);append('waiting_completed',plan.waitUntil,plan.origin.flights,plan.origin.airportId);continue;}
   const f=plan.forecast,index=plan.origin.flights+1;
   append('flight_committed',plan.origin.utcMs,index,plan.origin.airportId);
   const refuel=f.phases.find(p=>p.label==='refuelling');if(refuel)append('refuelling_started',refuel.route.startUtcMs,index,plan.origin.airportId);
   append('flight_started',f.departureUtcMs,index,plan.origin.airportId);append('arrived',f.arrivalUtcMs,index,plan.toId);
   append('flight_completed',f.endUtcMs,index,plan.toId);if(f.next!.won)append('mission_won',f.endUtcMs,index,plan.toId);
  }
  if(this.#noRoutes)append('mission_lost',this.#noRoutes.utcMs,this.#ready().flights,this.#ready().airportId);
  return events;
 }
 #base(r:ResearchState):MissionState {
  const d=this.#definition,status=this.#initialSun?'dead':r.won?'won':this.#noRoutes&&r.utcMs>=this.#noRoutes.utcMs?'lost':'running';
  return {mode:this.model.mode,schemaVersion:this.model.schemaVersion,simulationVersion:this.model.simulationVersion,scenarioId:d.scenarioId,scenarioVersion:d.scenarioVersion,seed:d.seed,stockVersion:d.stockVersion,worldVersion:d.worldVersion,
   startUtcMs:this.#initial.utcMs,utcMs:r.utcMs,airportId:r.airportId,position:{latitudeDeg:this.#airport(r.airportId).latitudeDeg,longitudeDeg:this.#airport(r.airportId).longitudeDeg},
   fuelKg:r.fuelKg,stocks:copy(r.stocks),flights:r.flights,distanceKm:r.distanceKm,status,phase:status==='running'?'planning':status,
   death:this.#initialSun?{kind:'sun',utcMs:this.#initial.utcMs}:null,result:status==='dead'?{kind:'sun',utcMs:this.#initial.utcMs}:status==='won'?{kind:'goal',utcMs:r.utcMs}:status==='lost'?{kind:'no_routes',utcMs:this.#noRoutes!.utcMs,checked:this.#noRoutes!.report.checked,total:this.#noRoutes!.report.total,reasons:copy(this.#noRoutes!.report.reasons)}:null,activeFlight:null};
 }
 #during(plan:AcceptedPlan,time:number):MissionState {
  if('expedition' in plan){
   const state=this.#base(plan.origin),phase=plan.forecast.phases.find(p=>time<p.route.endUtcMs)!;
   state.utcMs=time;state.phase=phase.label;state.position=routePhasePosition(phase.route,time);state.airportId=null;
   state.activeGround={startUtcMs:plan.origin.utcMs,acquiredUtcMs:plan.forecast.acquiredUtcMs,endUtcMs:plan.forecast.endUtcMs,stage:phase.label};
   return state;
  }
  if('waitUntil' in plan){const state=this.#base(plan.origin);state.utcMs=time;state.phase='waiting';state.activeWait={startUtcMs:plan.origin.utcMs,endUtcMs:plan.waitUntil};return state;}
  const f=plan.forecast,a=this.#definition.profile.assumptions,m=aircraftMetrics(this.#definition.profile),state=this.#base(plan.origin);
  state.utcMs=time;let fuel=plan.origin.fuelKg;
  for(const phase of f.phases) {
   const p=phase.route;if(time<p.startUtcMs)break;
   const elapsed=Math.max(0,Math.min(time,p.endUtcMs)-p.startUtcMs)/1000,duration=(p.endUtcMs-p.startUtcMs)/1000,fraction=duration===0?1:elapsed/duration;
   switch(phase.label) {
    case 'departure':fuel-=a.departureBurnKg*fraction;break;
    case 'cruise':fuel-=f.distanceKm*a.cruiseBurnKgPerKm*fraction;state.distanceKm=plan.origin.distanceKm+f.distanceKm*fraction;break;
    case 'arrival':fuel-=a.arrivalBurnKg*fraction;if(time>=p.endUtcMs)fuel=f.flight.arrivalFuelKg;break;
    case 'service':fuel-=a.serviceBurnKgPerSecond*elapsed;break;
    case 'refuelling': {
     const transfer=Math.min(f.refuelling!.transferKg,Math.max(0,elapsed-a.refuellingSetupSeconds)*m.refuellingKgPerSecond);
     fuel=Math.min(f.refuelling.fuelKg,plan.origin.fuelKg+transfer);state.stocks[plan.origin.airportId]=plan.origin.stocks[plan.origin.airportId]!-transfer;
     if(time>=p.endUtcMs){fuel=f.refuelling.fuelKg;state.stocks[plan.origin.airportId]=f.refuelling.stockKg;}break;
    }
   }
   if(time<p.endUtcMs) {
    state.phase=phase.label;state.position=routePhasePosition(p,time);
    state.airportId=(phase.label==='departure'||phase.label==='refuelling')?plan.origin.airportId:time>=f.arrivalUtcMs?plan.toId:null;
    state.activeFlight={fromId:plan.origin.airportId,toId:plan.toId,startUtcMs:plan.origin.utcMs,departureUtcMs:f.departureUtcMs,arrivalUtcMs:f.arrivalUtcMs,endUtcMs:f.endUtcMs,phaseStartUtcMs:p.startUtcMs,phaseEndUtcMs:p.endUtcMs};break;
   }
  }
  state.fuelKg=fuel;state.flights=plan.origin.flights+(time>=f.arrivalUtcMs?1:0);return state;
 }
 /** Preview may inspect accepted history/future, but never commits time, fuel or event delivery. */
 stateAt(utcMs:number):MissionView {
  validateUtcMs(utcMs);if(utcMs<this.#initial.utcMs)throw new RangeError('UTC precedes mission');
  const time=Math.min(utcMs,this.endUtcMs);let state=this.#base(this.#initial);
  for(const plan of this.#plans){if(time<plan.origin.utcMs)break;state=time>=plan.forecast.endUtcMs?this.#base(plan.forecast.next!):this.#during(plan,time);}
  if(this.#definition.chapterOne){
   const ground=this.#plans.find((p):p is AcceptedGround=>'expedition' in p),acquired=!!ground&&time>=ground.forecast.acquiredUtcMs,completed=!!ground&&time>=ground.forecast.endUtcMs;
   state.campaign={chapterOneCompleted:completed,knowledgeIds:acquired?['akademgorodok']:[],objective:completed?'tsukuba':'akademgorodok',playerLocation:state.activeGround?'ground':'aircraft'};
   state.aircraft={airportId:state.activeGround?this.#definition.chapterOne.airportId:state.airportId,position:state.activeGround?copy(this.#airport(this.#definition.chapterOne.airportId)):copy(state.position)};
   // Position contains coordinates only; airport metadata is not runtime state.
   state.aircraft.position={latitudeDeg:state.aircraft.position.latitudeDeg,longitudeDeg:state.aircraft.position.longitudeDeg};
  }
  return {state,events:this.#events().filter(e=>e.utcMs<=time)};
 }
 current():MissionView{return this.stateAt(this.#cursor);}
 stopAt(utcMs:number):MissionAdvance {
  validateUtcMs(utcMs);if(utcMs<this.#cursor)throw new RangeError('Execution cannot rewind');
  this.#cursor=Math.min(utcMs,this.endUtcMs);const view=this.current(),newEvents=view.events.slice(this.#consumedEvents);this.#consumedEvents=view.events.length;
  return {...view,newEvents};
 }
 resume():MissionAdvance{return this.stopAt(this.endUtcMs);}
 save():string {
  const payload:MissionPayload={mode:this.model.mode,simulationVersion:this.model.simulationVersion,eventVersion:this.model.eventVersion,definition:copy(this.#definition),options:copy(this.#options),
   choices:this.#plans.map(p=>'toId' in p?p.toId:'expedition' in p?{expedition:true}:{waitUntil:p.requestedUntil,stopUtcMs:p.waitUntil,...(p.destinationId?{destinationId:p.destinationId}:{})}),noRoutesAt:this.#noRoutes?.utcMs??null,cursorUtcMs:this.#cursor,consumedEvents:this.#consumedEvents,snapshot:this.current()};
  return canonicalJson({format:'into-the-night-mission',version:this.#definition.chapterOne?6:this.#plans.some(p=>'waitUntil' in p&&p.destinationId)?5:this.#plans.some(p=>'waitUntil' in p)?4:3,checksum:saveChecksum(payload),payload});
 }
 /** Separate format: historical survival saves are rejected rather than reinterpreted as food-free missions. */
 static restore(serialized:string,expectedDefinition?:MissionDefinition):MissionSession {
  if(typeof serialized!=='string'||serialized.length>16*1024*1024)throw new RangeError('Invalid mission save size');
  const envelope=JSON.parse(serialized) as {format:string;version:number;checksum:string;payload:MissionPayload};
  if(!envelope||envelope.format!=='into-the-night-mission'||![3,4,5,6].includes(envelope.version)||!envelope.payload||envelope.checksum!==saveChecksum(envelope.payload))throw new RangeError('Unsupported or damaged mission save');
  const p=envelope.payload;
  const model=p.definition?.chapterOne?CAMPAIGN_MODEL:MISSION_MODEL;
  if((model===CAMPAIGN_MODEL)!==(envelope.version===6)||p.mode!==model.mode||p.simulationVersion!==model.simulationVersion||p.eventVersion!==model.eventVersion)throw new RangeError('Incompatible mission save version');
  if(expectedDefinition&&canonicalJson(p.definition)!==canonicalJson(expectedDefinition))throw new RangeError('Mission definition differs');
  if(!Array.isArray(p.choices)||p.choices.length>1000||p.choices.some(choice=>{
   if(typeof choice==='string')return false;
   if(!choice||typeof choice!=='object')return true;
   if('expedition' in choice)return choice.expedition!==true||Object.keys(choice).length!==1;
   return Object.keys(choice).some(k=>!['waitUntil','stopUtcMs','destinationId'].includes(k))||
    (choice.destinationId!==undefined&&(typeof choice.destinationId!=='string'||!choice.destinationId))||
    !Number.isFinite(choice.waitUntil)||!Number.isFinite(choice.stopUtcMs);
  }))throw new RangeError('Invalid mission choices');
  const session=new MissionSession(p.definition,p.options);
  for(const [index,choice] of p.choices.entries()) {
   if(index)session.resume();
   if(typeof choice==='string'){
    if(!session.fly(choice).allowed)throw new RangeError('Saved flight is blocked');
    continue;
   }
   if('expedition' in choice){if(envelope.version!==6||!session.startExpedition().allowed)throw new RangeError('Saved expedition is blocked');continue;}
   if(envelope.version<4)throw new RangeError('Saved wait is blocked');
   let accepted:boolean;
   if(choice.destinationId){
    if(envelope.version<5)throw new RangeError('Saved wait is blocked');
    accepted=session.waitForDeparture(choice.destinationId,choice.waitUntil);
   }else accepted=session.waitUntil(choice.waitUntil).status==='safe';
   if(!accepted)throw new RangeError('Saved wait is blocked');
   if(choice.stopUtcMs<session.currentTimeUtc||choice.stopUtcMs>choice.waitUntil)throw new RangeError('Invalid stopped wait');
   if(choice.stopUtcMs<choice.waitUntil){session.stopAt(choice.stopUtcMs);session.cancelWait();}
  }
  validateUtcMs(p.cursorUtcMs);
  const lastStart=session.#plans.at(-1)?.origin.utcMs??session.#initial.utcMs;
  if(p.cursorUtcMs<lastStart||p.cursorUtcMs>session.endUtcMs)throw new RangeError('Invalid mission cursor');
  session.#cursor=p.cursorUtcMs;
  if(p.noRoutesAt!==null){
   if(p.noRoutesAt!==p.cursorUtcMs||session.current().state.phase!=='planning')throw new RangeError('Invalid no-routes cursor');
   session.resolvePlanning();if(session.current().state.status!=='lost')throw new RangeError('Saved no-routes result is not confirmed');
  }
  const actual=session.current();
  if(!Number.isInteger(p.consumedEvents)||p.consumedEvents<0||p.consumedEvents>actual.events.length||!matchesSnapshot(p.snapshot,actual))throw new RangeError('Mission save snapshot or journal differs');
  session.#consumedEvents=p.consumedEvents;return session;
 }
}
