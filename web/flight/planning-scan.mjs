// SPDX-License-Identifier: GPL-3.0-only
import {MissionSession} from '../../dist/core/mission.js';
import {MissionAvailabilityScan,inactiveAvailability} from '../../dist/core/mission-availability.js';
import {runMissionScan} from './scan-runner.mjs';
/** Snapshot-bound transport/progress. Only MissionSession may commit the result. */
export class FlightPlanningScan {
 constructor(controller,onChange,{workerFactory=()=>new Worker(new URL('./forecast-worker.mjs',import.meta.url),{type:'module'})}={}) {
  this.controller=controller;this.onChange=onChange;this.workerFactory=workerFactory;this.statuses=new Map();this.generation=0;this.key=null;this.scan=null;this.worker=null;this.destroyed=false;
 }
 alive(generation,key){return !this.destroyed&&generation===this.generation&&key===this.key&&key===this.controller.session.planningKey;}
 cancel(){this.generation++;this.worker?.terminate();this.worker=null;}
 reset(){this.cancel();this.key=null;this.scan=null;this.statuses.clear();}
 update(){
  const key=this.controller.session.planningKey;if(key===this.key)return;
  this.cancel();this.key=key;this.scan=null;
  if(this.controller.view.state.status!=='lost')this.statuses.clear();
  if(key===null)return;
  const state=this.controller.view.state,ids=this.controller.session.definition.airports.filter(a=>a.id!==state.airportId).map(a=>a.id);
  this.scan=new MissionAvailabilityScan(key,ids);const generation=this.generation;
  try{const worker=this.workerFactory();this.worker=worker;
   worker.onmessage=({data})=>{if(!this.alive(generation,key)||data?.generation!==generation||data?.key!==key)return;if(data.error){this.fallback();return;}this.receive(generation,key,data);};
   worker.onerror=()=>{if(this.alive(generation,key))this.fallback();};
   worker.postMessage({generation,key,save:this.controller.session.save()});
  }catch{this.fallback();}
 }
 receive(generation,key,data){
  if(!this.alive(generation,key))return;
  try{this.scan.accept(key,data.batch,data.done??false);for(const item of data.batch)this.statuses.set(item.id,item);
   const summary=this.scan.summary();
   if(summary.complete){this.worker?.terminate();this.worker=null;
    if(summary.status==='no_safe_choices'){
     const verified=this.controller.resolvePlanning().availability;
     // A transport result cannot override a safe forecast in the actual session.
     for(const id of verified.availableIds)this.statuses.set(id,{id,allowed:true,reasons:[]});
     if(this.controller.view.state.status==='running'&&verified.status!=='no_safe_choices'){
      this.scan=new MissionAvailabilityScan(key,this.controller.session.definition.airports.filter(a=>a.id!==this.controller.view.state.airportId).map(a=>a.id));
      // Recompute transport progress if its all-blocked claim was not confirmed.
      this.fallback();return;
     }
    }
   }
  }catch{this.fallback();return;}
  this.onChange();
 }
 fallback(){
  this.cancel();const generation=this.generation,key=this.key;if(key===null)return;
  this.scan=new MissionAvailabilityScan(key,this.controller.session.definition.airports.filter(a=>a.id!==this.controller.view.state.airportId).map(a=>a.id));this.statuses.clear();
  try{
   const session=MissionSession.restore(this.controller.session.save());
   runMissionScan(session,{alive:()=>this.alive(generation,key),emit:data=>this.receive(generation,key,data)}).catch(()=>this.fail(generation,key));
  }catch{this.fail(generation,key);}
 }
 fail(generation,key){if(!this.alive(generation,key))return;this.scan.fail();this.onChange();}
 retry(){this.reset();this.update();this.onChange();}
 record(id,choice){
  this.update();if(!this.scan||!choice||id===this.controller.view.state.airportId||!this.controller.session.definition.airports.some(a=>a.id===id))return;
  try{this.scan.accept(this.key,[{id,allowed:choice.allowed,reasons:choice.reasons}]);this.statuses.set(id,{id,allowed:choice.allowed,reasons:choice.reasons});}catch{this.fallback();}
 }
 summary(){if(this.scan)return this.scan.summary();const state=this.controller.view.state;
  if(state.status==='lost')return this.controller.session.availability();
  return inactiveAvailability(state.status==='running'?'busy':'terminal');
 }
 destroy(){this.destroyed=true;this.reset();}
}
