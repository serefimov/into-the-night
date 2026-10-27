// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile} from 'node:fs/promises';
import {MissionSession} from '../dist/core/mission.js';
import {parseUtc} from '../dist/core/time.js';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
try {
 const args=process.argv.slice(2),flags={},values=new Set(['--path','--stop-at','--save','--load','--definition']);
 for(let i=0;i<args.length;i++) {
  const key=args[i];if(key in flags)throw Error('Duplicate argument');
  if(key==='--resume'){flags[key]=true;continue;}
  if(!values.has(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid mission-cycle arguments');flags[key]=args[++i];
 }
 if(flags['--load']&&flags['--definition'])throw Error('Choose definition or saved session');
 const session=flags['--load']?MissionSession.restore(await readFile(flags['--load'],'utf8')):new MissionSession(await loadCycleDefinition(flags['--definition']));
 const path=flags['--path']?JSON.parse(await readFile(flags['--path'],'utf8')):[];
 if(!Array.isArray(path)||path.some(id=>typeof id!=='string'))throw Error('Path must be an array of airport IDs');
 const stop=flags['--stop-at']?parseUtc(flags['--stop-at']):null;let blocked=null;
 if(flags['--resume'])session.resume();
 for(const to of path) {
  if(stop!==null&&stop<session.currentTimeUtc)throw Error('Stop UTC precedes current state');
  const choice=session.fly(to);if(!choice.allowed){blocked={to,reasons:choice.reasons,solar:choice.forecast?.solar??null};break;}
  if(stop!==null&&stop<session.endUtcMs){session.stopAt(stop);break;}
  session.resume();
 }
 if(!path.length&&stop!==null)session.stopAt(stop);
 const availability=session.resolvePlanning().availability;
 if(flags['--save'])await writeFile(flags['--save'],session.save()+'\n');
 const {state,events}=session.current(),visited=new Set([session.definition.initial.airportId,...events.filter(e=>e.kind==='arrived').map(e=>e.airportId)]);
 console.log(JSON.stringify({blocked,availability,state:{...state,stocks:Object.fromEntries([...visited].map(id=>[id,state.stocks[id]]))},events},null,2));
 if(state.status==='lost')process.exitCode=3;else if(blocked)process.exitCode=2;
} catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
