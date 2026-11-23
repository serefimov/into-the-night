// SPDX-License-Identifier: GPL-3.0-only
import type {ChapterOneDefinition} from './mission-ground.js';
import {aircraftLeg,aircraftMetrics,aircraftRefuelling} from './aircraft.js';
import {greatCircle} from './geometry.js';
import {validateResearchState,auditResearchPhases} from './mission-research.js';
import type {ResearchWorld,ResearchState,ResearchPhase,PhaseAudit} from './mission-research.js';
import type {SearchOptions} from './interval-search.js';
import type {RoutePhase} from './route.js';
import type {Coordinates} from './solar.js';
import {validateUtcMs} from './time.js';

export interface MissionWorld extends Omit<ResearchWorld,'targetCompletion'> {targetCompletion:'arrival'|'after_service';chapterOne?:ChapterOneDefinition}
export interface MissionForecast {
 allowed:boolean;reasons:readonly string[];distanceKm:number;departureUtcMs:number;arrivalUtcMs:number;endUtcMs:number;
 flight:ReturnType<typeof aircraftLeg>;
 refuelling:ReturnType<typeof aircraftRefuelling>&{airportId:string;neededKg:number;requiredFuelKg:number;sufficient:boolean};
 phases:readonly ResearchPhase[];solar:PhaseAudit;solarScope:'departure_and_flight'|'departure_flight_service'|'invalid_resources';next:ResearchState|null;
}
/** New dispatch policy only. Historical research transitions remain tied to their original rules. */
export function forecastMissionFlight(world:MissionWorld,state:ResearchState,destinationId:string,options:SearchOptions={}):MissionForecast {
 validateResearchState({profile:world.profile,airports:world.airports,targetId:world.targetId},state);
 if(state.won)throw new RangeError('Mission already complete');
 if(!['arrival','after_service'].includes(world.targetCompletion))throw new RangeError('Invalid mission completion');
 const from=world.airports.find(a=>a.id===state.airportId)!,to=world.airports.find(a=>a.id===destinationId);if(!to)throw new RangeError('Unknown airport: '+destinationId);
 const path=greatCircle(from,to),p=world.profile,a=p.assumptions,m=aircraftMetrics(p),reference=aircraftLeg(p,path.distanceKm,state.fuelKg);
 const terminalArrival=destinationId===world.targetId&&world.targetCompletion==='arrival',serviceSeconds=terminalArrival?0:a.serviceSeconds;
 const requiredFuelKg=reference.burnKg+a.planningReserveKg+serviceSeconds*a.serviceBurnKgPerSecond,neededKg=Math.max(0,requiredFuelKg-state.fuelKg);
 const refuelling={...aircraftRefuelling(p,state.fuelKg,state.stocks[from.id]!,Math.min(requiredFuelKg,m.fuelCapacityKg)),airportId:from.id,neededKg,requiredFuelKg,sufficient:false};
 refuelling.sufficient=refuelling.fuelKg>=requiredFuelKg;
 const flight=aircraftLeg(p,path.distanceKm,refuelling.fuelKg),reasons=[...flight.reasons];
 if(requiredFuelKg>m.fuelCapacityKg)reasons.push('fuel_capacity');
 if(neededKg>state.stocks[from.id]!)reasons.push('fuel_stock');
 if(!refuelling.sufficient&&!reasons.includes('fuel_or_reference_reserve'))reasons.push('fuel_or_reference_reserve');
 if(to.suitability.status!=='screened-candidate')reasons.push('unverified_airport');
 const phases:ResearchPhase[]=[];let cursor=state.utcMs;
 function append(label:ResearchPhase['label'],kind:RoutePhase['kind'],location:Coordinates,seconds:number,moving=false):void {
  const start=cursor;cursor+=seconds*1000;validateUtcMs(cursor);
  phases.push({label,route:{kind,legIndex:state.flights,startUtcMs:start,endUtcMs:cursor,location:{latitudeDeg:location.latitudeDeg,longitudeDeg:location.longitudeDeg},path:moving?path:null}});
 }
 if(refuelling.durationSeconds>0)append('refuelling','service',from,refuelling.durationSeconds);
 const departureUtcMs=cursor;
 append('departure','takeoff',from,a.departureSeconds);append('cruise','cruise',from,path.distanceKm/m.cruiseKmPerHour*3600,true);append('arrival','landing',to,a.arrivalSeconds);
 const arrivalUtcMs=cursor;if(!terminalArrival)append('service','service',to,serviceSeconds);
 const fuelKg=flight.arrivalFuelKg-serviceSeconds*a.serviceBurnKgPerSecond;if(fuelKg<0)reasons.push('ground_fuel');
 const invalidResources=reasons.length>0,solar=auditResearchPhases(phases,options);
 if(solar.status!=='safe')reasons.push(solar.status==='unsafe'?'sun':'solar_indeterminate');
 const allowed=reasons.length===0;
 const next=allowed?{airportId:destinationId,utcMs:cursor,fuelKg,stocks:{...state.stocks,[from.id]:refuelling.stockKg},flights:state.flights+1,distanceKm:state.distanceKm+path.distanceKm,won:destinationId===world.targetId&&!world.chapterOne}:null;
 return {allowed,reasons,distanceKm:path.distanceKm,departureUtcMs,arrivalUtcMs,endUtcMs:cursor,flight,refuelling,phases,solar,solarScope:invalidResources?'invalid_resources':terminalArrival?'departure_and_flight':'departure_flight_service',next};
}
