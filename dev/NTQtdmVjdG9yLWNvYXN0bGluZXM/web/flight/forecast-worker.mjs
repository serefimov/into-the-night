// SPDX-License-Identifier: GPL-3.0-only
import {MissionSession} from '../../dist/core/mission.js';
import {runMissionScan} from './scan-runner.mjs';
let token=0;
self.onmessage=async({data})=>{
 const epoch=++token;if(data.cancel)return;
 try {
  const session=MissionSession.restore(data.save);
  if(session.planningKey!==data.key)throw Error('Planning snapshot differs');
  await runMissionScan(session,{alive:()=>epoch===token,emit:result=>self.postMessage({generation:data.generation,key:data.key,...result})});
 }catch{self.postMessage({generation:data.generation,key:data.key,error:true});}
};
