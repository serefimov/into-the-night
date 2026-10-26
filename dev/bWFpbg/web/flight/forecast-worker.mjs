// SPDX-License-Identifier: GPL-3.0-only
import {MissionSession} from '../../dist/core/mission.js';
let generation=0;
self.onmessage=async({data})=>{
 const token=++generation;if(data.cancel)return;
 try {
  const session=MissionSession.restore(data.save),airports=session.definition.airports;let batch=[];
  for(let i=0;i<airports.length;i++) {
   if(token!==generation)return;const id=airports[i].id,f=session.forecast(id);batch.push({id,allowed:f.allowed,reasons:f.reasons});
   if(batch.length===24||i===airports.length-1){self.postMessage({generation:data.generation,batch,done:i===airports.length-1});batch=[];await new Promise(r=>setTimeout(r,0));}
  }
 }catch{self.postMessage({generation:data.generation,error:true});}
};
