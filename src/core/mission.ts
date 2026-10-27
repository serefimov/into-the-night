// SPDX-License-Identifier: GPL-3.0-only
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

export const MISSION_MODEL=Object.freeze({mode:'airport-flight-v3',simulationVersion:'flight-cycle-3',schemaVersion:3,eventVersion:3,saveVersion:3} as const);
export interface MissionDefinition extends MissionWorld {
 scenarioId:string; scenarioVersion:number; seed:string; stockVersion:string; worldVersion:string;
 targetCompletion:'arrival'|'after_service';
 initial:{airportId:string; utcMs:number; fuelKg:number; stocks:Record<string,number>};
}
export interface MissionEvent {
 version:3; sequence:number; utcMs:number; flightIndex:number; airportId:string;
 kind:'mission_started'|'flight_committed'|'flight_started'|'arrived'|'refuelling_started'|'flight_completed'|'mission_won'|'mission_died'|'mission_lost';
}
export interface MissionState {
 mode:typeof MISSION_MODEL.mode; schemaVersion:3; simulationVersion:string; scenarioId:string; scenarioVersion:number; seed:string; stockVersion:string; worldVersion:string;
 startUtcMs:number; utcMs:number; airportId:string|null; position:Coordinates; fuelKg:number; stocks:Record<string,number>;
 flights:number; distanceKm:number; status:'running'|'won'|'dead'|'lost';
 phase:'planning'|'won'|'dead'|'lost'|ResearchPhase['label']; death:null|{kind:'sun';utcMs:number};
 result:MissionResult|null;
 activeFlight:null|{fromId:string;toId:string;startUtcMs:number;departureUtcMs:number;arrivalUtcMs:number;endUtcMs:number;phaseStartUtcMs:number;phaseEndUtcMs:number};
}
export type MissionResult={kind:'goal'|'sun';utcMs:number}|{kind:'no_routes';utcMs:number;checked:number;total:number;reasons:Record<AvailabilityReason,number>};
export interface MissionView {state:MissionState;events:MissionEvent[]}
export interface MissionAdvance extends MissionView {newEvents:MissionEvent[]}
export interface MissionChoice {allowed:boolean; reasons:readonly string[]; forecast:MissionForecast|null}
interface AcceptedFlight {origin:ResearchState;toId:string;forecast:MissionForecast}
interface MissionPayload {
 mode:string;simulationVersion:string;eventVersion:number;definition:MissionDefinition;options:SearchOptions;
 choices:string[];noRoutesAt:number|null;cursorUtcMs:number;consumedEvents:number;snapshot:MissionView;
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
 validateResearchState({profile:d.profile,airports:d.airports,targetId:d.targetId},initialResearch(d));
}
function validateOptions(options:SearchOptions):void {
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['eventToleranceSeconds','maxIntervalSeconds','maxEvaluations'].includes(k)))throw new RangeError('Invalid mission search options');
 searchLimits(options);
}
/** A no-food, no-wait session. The shared departure-fuel transition supplies every accepted physical plan. */
export class MissionSession {
 #definition:MissionDefinition; #options:SearchOptions; #initial:ResearchState; #plans:AcceptedFlight[]=[];
 #cursor:number; #consumedEvents=0; #initialSun:boolean; #definitionHash:string; #noRoutes:null|{utcMs:number;report:MissionAvailability}=null;
 constructor(definition:MissionDefinition,options:SearchOptions={}) {
  this.#definition=copy(definition);this.#options=copy(options);validateDefinition(this.#definition);validateOptions(this.#options);
  this.#definitionHash=saveChecksum(this.#definition);
  this.#initial=initialResearch(this.#definition);this.#cursor=this.#initial.utcMs;
  this.#initialSun=!solarExposure(this.#airport(this.#initial.airportId),this.#cursor).safe;
 }
 get definition():MissionDefinition{return copy(this.#definition);}
 get currentTimeUtc():number{return this.#cursor;}
 get endUtcMs():number{return this.#plans.at(-1)?.forecast.endUtcMs??this.#initial.utcMs;}
 get planningKey():string|null {const state=this.current().state;return state.status==='running'&&state.phase==='planning'?saveChecksum({definition:this.#definitionHash,options:this.#options,state:this.#ready()}):null;}
 #airport(id:string) {return this.#definition.airports.find(a=>a.id===id)!;}
 #ready():ResearchState {return this.#plans.at(-1)?.forecast.next??this.#initial;}
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
  * Worker counts are progress, never authority to end a party. No-wait policy (#25 revises it). */
 resolvePlanning():MissionAdvance&{availability:MissionAvailability} {
  const availability=this.availability();
  if(!this.#noRoutes&&this.current().state.phase==='planning'&&availability.status==='no_safe_choices'&&availability.complete){
   this.#noRoutes={utcMs:this.#cursor,report:copy(availability)};
   return {...this.stopAt(this.#cursor),availability};
  }
  return {...this.current(),newEvents:[],availability};
 }
 #events():MissionEvent[] {
  const events:MissionEvent[]=[];
  const append=(kind:MissionEvent['kind'],utcMs:number,flightIndex:number,airportId:string)=>events.push({version:3,sequence:events.length,kind,utcMs,flightIndex,airportId});
  append('mission_started',this.#initial.utcMs,0,this.#initial.airportId);
  if(this.#initialSun)append('mission_died',this.#initial.utcMs,0,this.#initial.airportId);
  for(const plan of this.#plans){const f=plan.forecast,index=plan.origin.flights+1;
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
  return {mode:MISSION_MODEL.mode,schemaVersion:3,simulationVersion:MISSION_MODEL.simulationVersion,scenarioId:d.scenarioId,scenarioVersion:d.scenarioVersion,seed:d.seed,stockVersion:d.stockVersion,worldVersion:d.worldVersion,
   startUtcMs:this.#initial.utcMs,utcMs:r.utcMs,airportId:r.airportId,position:{latitudeDeg:this.#airport(r.airportId).latitudeDeg,longitudeDeg:this.#airport(r.airportId).longitudeDeg},
   fuelKg:r.fuelKg,stocks:copy(r.stocks),flights:r.flights,distanceKm:r.distanceKm,status,phase:status==='running'?'planning':status,
   death:this.#initialSun?{kind:'sun',utcMs:this.#initial.utcMs}:null,result:status==='dead'?{kind:'sun',utcMs:this.#initial.utcMs}:status==='won'?{kind:'goal',utcMs:r.utcMs}:status==='lost'?{kind:'no_routes',utcMs:this.#noRoutes!.utcMs,checked:this.#noRoutes!.report.checked,total:this.#noRoutes!.report.total,reasons:copy(this.#noRoutes!.report.reasons)}:null,activeFlight:null};
 }
 #during(plan:AcceptedFlight,time:number):MissionState {
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
  const payload:MissionPayload={mode:MISSION_MODEL.mode,simulationVersion:MISSION_MODEL.simulationVersion,eventVersion:3,definition:copy(this.#definition),options:copy(this.#options),
   choices:this.#plans.map(p=>p.toId),noRoutesAt:this.#noRoutes?.utcMs??null,cursorUtcMs:this.#cursor,consumedEvents:this.#consumedEvents,snapshot:this.current()};
  return canonicalJson({format:'into-the-night-mission',version:3,checksum:saveChecksum(payload),payload});
 }
 /** Separate format: historical survival saves are rejected rather than reinterpreted as food-free missions. */
 static restore(serialized:string,expectedDefinition?:MissionDefinition):MissionSession {
  if(typeof serialized!=='string'||serialized.length>16*1024*1024)throw new RangeError('Invalid mission save size');
  const envelope=JSON.parse(serialized) as {format:string;version:number;checksum:string;payload:MissionPayload};
  if(!envelope||envelope.format!=='into-the-night-mission'||envelope.version!==3||!envelope.payload||envelope.checksum!==saveChecksum(envelope.payload))throw new RangeError('Unsupported or damaged mission save');
  const p=envelope.payload;
  if(p.mode!==MISSION_MODEL.mode||p.simulationVersion!==MISSION_MODEL.simulationVersion||p.eventVersion!==3)throw new RangeError('Incompatible mission save version');
  if(expectedDefinition&&canonicalJson(p.definition)!==canonicalJson(expectedDefinition))throw new RangeError('Mission definition differs');
  if(!Array.isArray(p.choices)||p.choices.length>1000||p.choices.some(id=>typeof id!=='string'))throw new RangeError('Invalid mission choices');
  const session=new MissionSession(p.definition,p.options);
  for(const [i,id] of p.choices.entries()) {if(i)session.resume();if(!session.fly(id).allowed)throw new RangeError('Saved flight is blocked');}
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
