// SPDX-License-Identifier: GPL-3.0-only
/** The same asynchronous full-catalog scan runs in a worker or on the main thread.
 * It calls only the shared session forecast; grouping and camera are absent. */
export async function runMissionScan(session,{emit,alive=()=>true,batchSize=24,priority=()=>null}) {
 const state=session.current().state;if(state.status!=='running'||state.phase!=='planning')return;
 const ids=session.definition.airports.filter(a=>a.id!==state.airportId).map(a=>a.id);
 await new Promise(r=>setTimeout(r,0));
 for(let i=0;i<ids.length;i+=batchSize){
  if(!alive())return;
  const batch=ids.slice(i,i+batchSize).map(id=>{const choice=session.forecast(id);return {id,allowed:choice.allowed,reasons:choice.reasons};});
  if(!alive())return;emit({batch,done:i+batchSize>=ids.length});await new Promise(r=>setTimeout(r,0));
 }
 const pending=[...ids];let checked=0,windowBatch=[];
 while(pending.length){
  if(!alive())return;
  const preferred=pending.indexOf(priority()),id=pending.splice(preferred<0?0:preferred,1)[0];
  const steps=session.departureWindowSteps(id);let step=steps.next();
  while(!step.done){await new Promise(r=>setTimeout(r,0));if(!alive())return;step=steps.next();}
  if(!alive())return;
  const window=step.value;
  // Transport needs a display forecast, not a copy of every warehouse per row.
  windowBatch.push({id,window:{...window,forecast:window.status==='waiting'?{...window.forecast,next:null}:null}});checked++;
  if(windowBatch.length>=8||id===priority()||!pending.length){emit({windowBatch,windowsChecked:checked,windowsTotal:ids.length,windowsDone:pending.length===0});windowBatch=[];}
  await new Promise(r=>setTimeout(r,0));
 }

}
