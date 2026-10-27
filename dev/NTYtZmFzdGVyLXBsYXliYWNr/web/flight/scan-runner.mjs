// SPDX-License-Identifier: GPL-3.0-only
/** The same asynchronous full-catalog scan runs in a worker or on the main thread.
 * It calls only the shared session forecast; grouping and camera are absent. */
export async function runMissionScan(session,{emit,alive=()=>true,batchSize=24}) {
 const state=session.current().state;if(state.status!=='running'||state.phase!=='planning')return;
 const ids=session.definition.airports.filter(a=>a.id!==state.airportId).map(a=>a.id);
 await new Promise(r=>setTimeout(r,0));
 for(let i=0;i<ids.length;i+=batchSize){
  if(!alive())return;
  const batch=ids.slice(i,i+batchSize).map(id=>{const choice=session.forecast(id);return {id,allowed:choice.allowed,reasons:choice.reasons};});
  if(!alive())return;emit({batch,done:i+batchSize>=ids.length});await new Promise(r=>setTimeout(r,0));
 }
}
