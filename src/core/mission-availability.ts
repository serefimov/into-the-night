// SPDX-License-Identifier: GPL-3.0-only
import {canonicalJson} from './serialization.js';
export type AvailabilityReason='airport'|'mass'|'fuel'|'sun'|'geometry';
export interface AvailabilityChoice {id:string;allowed:boolean;reasons:readonly string[]}
export interface MissionAvailability {
 status:'checking'|'available'|'unresolved'|'no_safe_choices'|'busy'|'terminal'|'failed';
 key:string|null;checked:number;total:number;remaining:number;complete:boolean;
 availableIds:string[];unresolvedIds:string[];blockedCount:number;reasons:Record<AvailabilityReason,number>;
}
const counts=():Record<AvailabilityReason,number>=>({airport:0,mass:0,fuel:0,sun:0,geometry:0});
/** A known resource/policy block is sufficient even when solar safety is unresolved.
 * Unknown/context-only reasons never establish a planning dead end. */
export function availabilityReason(choice:Pick<AvailabilityChoice,'allowed'|'reasons'>):AvailabilityReason|'available'|'unresolved' {
 if(choice.allowed)return 'available';
 const r=choice.reasons;
 if(r.includes('unverified_airport'))return 'airport';
 if(r.some(x=>['takeoff_mass','landing_mass'].includes(x)))return 'mass';
 if(r.some(x=>['fuel_stock','fuel_capacity','fuel_or_reference_reserve','ground_fuel'].includes(x)))return 'fuel';
 if(r.includes('ambiguous_route'))return 'geometry';
 if(r.includes('sun'))return 'sun';
 return 'unresolved';
}
export function inactiveAvailability(status:'busy'|'terminal',total=0):MissionAvailability {
 return {status,key:null,checked:0,total,remaining:total,complete:false,availableIds:[],unresolvedIds:[],blockedCount:0,reasons:counts()};
}
/** Transport-independent progress for one immutable planning snapshot. No camera inputs. */
export class MissionAvailabilityScan {
 readonly key:string;#ids:Set<string>;#records=new Map<string,AvailabilityChoice>();#finished=false;#failed=false;
 constructor(key:string,destinationIds:readonly string[]) {
  if(!key||new Set(destinationIds).size!==destinationIds.length||destinationIds.some(id=>typeof id!=='string'||!id))throw new RangeError('Invalid availability snapshot');
  this.key=key;this.#ids=new Set(destinationIds);
 }
 accept(key:string,batch:readonly AvailabilityChoice[],done=false):boolean {
  if(key!==this.key)return false;
  if(!Array.isArray(batch)||typeof done!=='boolean')throw new RangeError('Invalid availability batch');
  const next=new Map(this.#records);
  for(const item of batch as readonly AvailabilityChoice[]){
   if(!item||!this.#ids.has(item.id)||typeof item.allowed!=='boolean'||!Array.isArray(item.reasons)||item.reasons.some((r:unknown)=>typeof r!=='string'||!r)||item.allowed&&item.reasons.length||!item.allowed&&!item.reasons.length)throw new RangeError('Invalid availability choice');
   const normalized:AvailabilityChoice={id:item.id,allowed:item.allowed,reasons:[...new Set<string>(item.reasons)].sort()},previous=next.get(item.id);
   if(previous&&canonicalJson(previous)!==canonicalJson(normalized))throw new RangeError('Conflicting availability choice');
   next.set(item.id,normalized);
  }
  if(done&&next.size!==this.#ids.size)throw new RangeError('Incomplete availability result');
  this.#records=next;this.#finished=this.#finished||done;return true;
 }
 fail():void {this.#failed=true;}
 summary():MissionAvailability {
  const availableIds:string[]=[],unresolvedIds:string[]=[],reasons=counts();
  for(const item of this.#records.values()){const reason=availabilityReason(item);if(reason==='available')availableIds.push(item.id);else if(reason==='unresolved')unresolvedIds.push(item.id);else reasons[reason]++;}
  availableIds.sort();unresolvedIds.sort();const checked=this.#records.size,total=this.#ids.size,complete=this.#finished&&!this.#failed;
  return {status:this.#failed?'failed':availableIds.length?'available':!complete?'checking':unresolvedIds.length?'unresolved':'no_safe_choices',key:this.key,checked,total,remaining:total-checked,complete,
   availableIds,unresolvedIds,blockedCount:Object.values(reasons).reduce((a,b)=>a+b,0),reasons};
 }
}
