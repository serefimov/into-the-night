import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSimulation, forecastPlan, executePlan, visibleState, SIMULATION_CONFIG } from '../dist/core/simulation.js';
import { ForecastTimeline, SimulationSession, SessionError } from '../dist/core/sessions.js';
import { serializeSession, restoreSession } from '../dist/core/saves.js';
import { forecastStanding } from '../dist/core/waiting.js';
import { parseUtc } from '../dist/core/time.js';
function writeSave(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary,data,{encoding:'utf8',flag:'wx'});renameSync(temporary,path); }
  finally { rmSync(temporary,{force:true}); }
}
try {
  const args = process.argv.slice(2), values = new Map();
  let confirmRisk = false;
  for (let i=0;i<args.length;i++) {
    if (args[i]==='--confirm-risk'&&!confirmRisk) { confirmRisk=true;continue; }
    if (['--plan','--mode','--stop-at','--stop-after','--save','--restore'].includes(args[i])&&args[i+1]&&!values.has(args[i])) {
      values.set(args[i],args[++i]);continue;
    }
    throw new Error('Usage: --plan FILE | --restore SAVE [--mode forecast|execute|standing] [--stop-at UTC | --stop-after SECONDS] [--save FILE] [--confirm-risk]');
  }
  const mode=values.get('--mode')??'forecast',file=values.get('--plan'),restore=values.get('--restore'),save=values.get('--save');
  const stopAt=values.get('--stop-at'),stopAfter=values.get('--stop-after');
  if ((!file&&!restore)||!['forecast','execute','standing'].includes(mode)||(confirmRisk&&mode!=='execute')||
      (stopAt!==undefined&&stopAfter!==undefined)||(save&&mode!=='execute')||(restore&&(mode==='standing'||confirmRisk))||
      (mode==='standing'&&(stopAt!==undefined||stopAfter!==undefined))) throw new Error('Invalid CLI arguments.');
  const input=file?JSON.parse(readFileSync(file,'utf8')):null;
  let result;
  if (restore) {
    const session=restoreSession(readFileSync(restore,'utf8'),input?.world);
    const target=targetTime(session.currentTimeUtc,session.endUtcMs);
    result=mode==='execute'?session.stopAt(target):session.stateAt(target);
    if(save)writeSave(save,serializeSession(session));
  } else {
    const state=createSimulation(input.world,input.stocks,parseUtc(input.utc),input.airportId,input.aircraft,input.serviced??true);
    if(mode==='standing') {
      result={outcome:'standing',state:visibleState(input.world,state),waiting:forecastStanding({position:state.aircraft.position,
        startUtcMs:state.currentTimeUtc,crew:SIMULATION_CONFIG.crew,foodPersonHours:state.aircraft.foodPersonHours+state.stocks[state.aircraft.airportId].foodPersonHours},input.waitingOptions)};
    } else if(stopAt!==undefined||stopAfter!==undefined||save) {
      const timeline=mode==='execute'?new SimulationSession(input.world,state,input.actions,{confirmRisk}):new ForecastTimeline(input.world,state,input.actions);
      const target=targetTime(state.currentTimeUtc,timeline.endUtcMs);
      result=mode==='execute'?timeline.stopAt(target):timeline.stateAt(target);
      if(save)writeSave(save,serializeSession(timeline));
    } else {
      result=mode==='forecast'?forecastPlan(input.world,state,input.actions):executePlan(input.world,state,input.actions,{confirmRisk});
      if(mode==='execute')result.state=visibleState(input.world,result.state);
    }
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.outcome==='validation_error')process.exitCode=2;
  function targetTime(currentUtc,endUtc) {
    if(stopAt!==undefined)return parseUtc(stopAt);
    if(stopAfter!==undefined) {
      const seconds=Number(stopAfter);
      if(!Number.isFinite(seconds)||seconds<0||!stopAfter.trim())throw new Error('Invalid --stop-after seconds.');
      return currentUtc+seconds*1000;
    }
    return endUtc;
  }
} catch(error) {
  if(error instanceof SessionError) {
    process.stdout.write(JSON.stringify({outcome:error.outcome,message:error.message})+'\n');
    if(error.outcome==='validation_error')process.exitCode=2;
  } else { process.stderr.write(JSON.stringify({error:'validation_error',message:error.message})+'\n');process.exitCode=2; }
}
