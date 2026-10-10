import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { inputFor, initial, direct, via, runBatches, until, compact, lowerBoundInput, publicForecastIndependent, DAY, modelConfig, readJson } from './spike-lib.mjs';
import { parseUtc } from '../dist/core/time.js';
import { SOLAR_MODEL } from '../dist/core/config.js';
import { ROUTE_MODEL } from '../dist/core/route.js';
import { searchStationarySunrise } from '../dist/core/waiting.js';
import { canonicalJson } from '../dist/core/saves.js';
export function research(write=false,verify=false) {
  const started=performance.now(),input=inputFor();
  const plans={
    'direct-30':until(input,direct,30),
    'via-tos-30':until(input,via,30),
    'direct-90':until(input,direct,90),
    'seasonal-departure':[...direct,{actions:[{kind:'auto_wait'}]},
      {actions:[{kind:'load',fuelKg:6000,foodPersonHours:600},{kind:'prepare'},{kind:'fly',destinationId:'TOS'}]},
      {actions:[{kind:'service'}]}],
    'revisit':[...direct,{actions:[{kind:'load',fuelKg:6000,foodPersonHours:600},{kind:'prepare'},{kind:'fly',destinationId:'TOS'}]},
      {actions:[{kind:'service'},{kind:'prepare'},{kind:'fly',destinationId:'LYR'}]},{actions:[{kind:'service'}]}]
  };
  const results={},planInputs={};
  for(const [name,batches] of Object.entries(plans)) {
    const full=runBatches(input,batches), lower=runBatches(lowerBoundInput(input),batches,{},false);
    assert.equal(full.outcome,'completed');assert.equal(lower.outcome,'completed');
    if(name.endsWith('30'))assert.ok(full.state.achievements.includes(30));
    if(name==='direct-90')assert.ok(full.state.achievements.includes(90));
    results[name]={...compact(full),visibleRanges:{unvisitedWarehouseFloorsReplayed:true,
      forecastIndependentOfHiddenStocks:publicForecastIndependent(input,batches),outcome:lower.outcome,
      survivedDays:(lower.state.currentTimeUtc-lower.state.startTimeUtc)/DAY,
      policy:'Opening actions are fixed before discovery; later loading uses only the visited warehouse. Minimum-stock replay tests these decisions, not all possible seeds.'}};
  }
  assert.ok(results.revisit.stages.at(-1).warehouses.LYR.fuelKg < input.stocks.LYR.fuelKg-5999);
  const auto=runBatches(input,[...direct,{actions:[{kind:'auto_wait'}]}]);
  assert.equal(auto.outcome,'waiting_stopped');assert.ok(auto.state.waitingWarning.reasons.includes('sunrise_warning'));
  plans['sunrise-threshold']=[...direct,{actions:[{kind:'auto_wait'}]}];results['sunrise-threshold']=compact(auto);
  const foodScales=[10,40,100].map(days=>{
    const scaled={...input,stocks:structuredClone(input.stocks),world:structuredClone(input.world)};
    // Explicit experimental input, not a silent change to the versioned scenario generator.
    scaled.world.scenarioId=`norway-food-scale-${days}`;
    scaled.stocks.LYR.foodPersonHours=days*720;
    scaled.world.airports.find(a=>a.id==='LYR').stockBounds.foodPersonHours=[days*720,days*720];
    const name=`food-scale-${days}`;
    plans[name]=[...direct,{actions:[{kind:'auto_wait'}]}];planInputs[name]=scaled;
    const r=runBatches(scaled,plans[name]);results[name]=compact(r);
    const target=runBatches(scaled,until(scaled,direct,30),{},false);
    return {warehouseCrewDays:days,aircraftAndFuelUnchanged:true,warningUtc:r.state.currentTimeUtc,
      warningReasons:r.state.waitingWarning?.reasons,thirtyDayOutcome:target.outcome,
      thirtyDaySurvivedDays:(target.state.currentTimeUtc-target.state.startTimeUtc)/DAY};
  });
  assert.equal(foodScales[0].thirtyDayOutcome,'death');assert.equal(foodScales[1].thirtyDayOutcome,'completed');
  plans['seasonal-limit']=[...plans['seasonal-departure'],{actions:[{kind:'wait',seconds:3*86400}],confirmRisk:true}];
  results['seasonal-limit']=compact(runBatches(input,plans['seasonal-limit']));
  assert.equal(results['seasonal-limit'].death.reason,'sun');
  plans['stay-to-180']=until(input,direct,180);
  results['stay-to-180']=compact(runBatches(input,plans['stay-to-180']));
  assert.equal(results['stay-to-180'].death.reason,'sun');
  const legacyInput={world:{scenarioId:'historical-osl-tos-lyr',scenarioVersion:1,seed:'historical-explicit-1',
    airports:[['OSL',60.202778,11.083889,6000,720],['TOS',69.681389,18.917778,8000,1440],['LYR',78.246111,15.465556,4000,1080]].map(([id,latitudeDeg,longitudeDeg,fuelKg,foodPersonHours])=>({id,latitudeDeg,longitudeDeg,stockBounds:{fuelKg:[fuelKg,fuelKg],foodPersonHours:[foodPersonHours,foodPersonHours]}}))},
    stocks:{OSL:{fuelKg:6000,foodPersonHours:720},TOS:{fuelKg:8000,foodPersonHours:1440},LYR:{fuelKg:4000,foodPersonHours:1080}},
    utc:'2026-11-20T03:00:00Z',airportId:'OSL',aircraft:{fuelKg:8000,foodPersonHours:180},serviced:true};
  const legacy=until(legacyInput,via,1);results['historical-regression']=compact(runBatches(legacyInput,legacy));
  assert.equal(results['historical-regression'].outcome,'completed');
  const searches=[];
  for(const [mode,worldInput] of [['true-stocks',input],['visible-range-floors',lowerBoundInput(input)]]) {
    for(const horizonDays of [30,90,180]) {
      const begin=performance.now();let candidates=0,best=null,found=null;const outcomes={};
      function attempt(batches) {
        candidates++;const result=runBatches(worldInput,batches,{},false);
        outcomes[result.outcome]=(outcomes[result.outcome]??0)+1;
        const elapsed=(result.state.currentTimeUtc-result.state.startTimeUtc)/DAY;
        if(best===null || elapsed>best.survivedDays)best={survivedDays:elapsed,outcome:result.outcome,death:result.state.death,batches};
        if(result.outcome==='completed' && elapsed>=horizonDays)found={batches,survivedDays:elapsed};
      }
      for(const opening of [direct,via]) {attempt(until(worldInput,opening,horizonDays));if(found)break;}
      if(!found) outer: for(const opening of [direct,via]) {
        const arrived=runBatches(worldInput,opening,{},false).state;
        for(const day of [30,60,75,85,89,90,120,150])for(const hour of [0,6,12,18])for(const destinationId of ['TOS','OSL']) {
          if(candidates>=130)break outer;
          const depart=parseUtc(worldInput.utc)+(day+hour/24)*DAY;
          const batches=[...opening,{actions:[{kind:'wait',seconds:(depart-arrived.currentTimeUtc)/1000}],confirmRisk:true},
            {actions:[{kind:'load',fuelKg:6000,foodPersonHours:600},{kind:'prepare'},{kind:'fly',destinationId}]},{actions:[{kind:'service'}]}];
          const pre=runBatches(worldInput,batches,{},false);
          const remaining=(parseUtc(worldInput.utc)+horizonDays*DAY-pre.state.currentTimeUtc)/1000;
          attempt(pre.outcome==='completed' && remaining>=0?[...batches,{actions:[{kind:'wait',seconds:remaining}],confirmRisk:true}]:batches);
          if(found)break outer;
        }
      }
      searches.push({mode,horizonDays,found:found!==null,candidates,maxCandidates:130,outcomes,best,
        witness:found?{batches:found.batches,survivedDays:found.survivedDays}:null,
        elapsedMs:performance.now()-begin,
        bounds:{catalogSize:3,maxFlights:3,openingRoutes:['OSL-LYR','OSL-TOS-LYR'],
          departureDayOffsets:[30,60,75,85,89,90,120,150],departureUtcHours:[0,6,12,18],
          destinationIds:['TOS','OSL'],loading:{fuelKg:6000,foodPersonHours:600},
          method:'Enumerate standing witnesses, then one timed evacuation and standing to target; no repeated hops, hemisphere crossings or arbitrary departure times.'}});
    }
  }
  assert.ok(searches.filter(s=>s.horizonDays<=90).every(s=>s.found));
  const tight=runBatches(input,plans['sunrise-threshold'],{eventToleranceSeconds:0.25,maxIntervalSeconds:300});
  const driftSeconds=Math.abs(auto.state.currentTimeUtc-tight.state.currentTimeUtc)/1000;
  assert.ok(driftSeconds<=0.5);
  const tightDeath=runBatches(input,plans['stay-to-180'],{eventToleranceSeconds:0.25,maxIntervalSeconds:300});
  const deathDriftSeconds=Math.abs(results['stay-to-180'].endUtcMs-tightDeath.state.currentTimeUtc)/1000;
  assert.ok(deathDriftSeconds<=0.5);
  const report={reportVersion:1,scenario:readJson('data/spike/scenario.json'),simulation:modelConfig,
    solarModelVersion:SOLAR_MODEL.version,routeModelVersion:ROUTE_MODEL.version,catalog:'data/spike/airports.json',
    generatedTrueStocks:input.stocks,experimental:true,
    start:{q: solarStart(input),sunrise:searchStationarySunrise(initial(input).aircraft.position,parseUtc(input.utc))},
    results,foodScales,searches,accuracy:{defaultEventToleranceSeconds:0.5,refinedEventToleranceSeconds:0.25,
      refinedMaxIntervalSeconds:300,warningDriftSeconds:driftSeconds,deathDriftSeconds,
      solarExtrema:'Sampled extrema every <=900 seconds per recorded phase, plus a conservative upper bound using the same curvature and evaluation-error bounds as the kernel. Safety comes from the unchanged continuous kernel.',
      physicalEphemerisError:'See SOLAR_MODEL.md: independent direction max 0.00839 degrees; polar timing example up to 455.8 seconds. Numeric brackets do not bound physical error.'},
    elapsedMs:performance.now()-started,limitations:[
      'Three-airport experimental world, not the final catalog or balance. Thirty and ninety days are certified only for these inputs and recorded actions.',
      'No 180-day witness in this bounded search; this is not proof of impossibility.',
      'Seasonal evacuation survives landing and service; TOS has sunlight the next morning. Twelve-hour warning does not guarantee months of escape.',
      'Minimum-range runs assess these fixed decisions. Hidden true stocks are printed only in research reports, not passed to destination forecasts.',
      'Generated food stores of 100..110 crew-days intentionally enable a winter study. They are fictional, finite and not airport inventory data.'
    ],passed:true};
  assert.ok(report.start.q<0);
  assert.ok(report.start.sunrise.eventUtcMs-parseUtc(input.utc)>4*3600000);
  const artifacts={};
  for(const search of searches) if(!search.found) {
    const name=`best-${search.horizonDays}-${search.mode}`;
    const searchInput=search.mode==='true-stocks'?input:lowerBoundInput(input);
    artifacts[`examples/spike/plans/${name}.json`]={planVersion:1,input:searchInput,batches:search.best.batches};
    results[name]=compact(runBatches(searchInput,search.best.batches));planInputs[name]=searchInput;
    search.best={...search.best,plan:`examples/spike/plans/${name}.json`};
    delete search.best.batches;
  }
  for(const [name,batches] of Object.entries(plans)) artifacts[`examples/spike/plans/${name}.json`]={planVersion:1,input:planInputs[name]??input,batches};
  artifacts['examples/spike/plans/historical-regression.json']={planVersion:1,input:legacyInput,batches:legacy};
  for(const [name,result] of Object.entries(results)) {
    const path=`docs/spike/${name}.json`;
    artifacts[path]={scenarioId:(name==='historical-regression'?legacyInput:(planInputs[name]??input)).world.scenarioId,
      scenarioVersion:1,simulationVersion:modelConfig.simulationVersion,seed:name==='historical-regression'?legacyInput.world.seed:input.world.seed,...result};
    const {stages,...summary}=result;
    report.results[name]={...summary,stagesReport:path};
  }
  artifacts['docs/SPIKE_VALIDATION.json']=report;
  if(write) {
    mkdirSync('examples/spike/plans',{recursive:true});mkdirSync('docs/spike',{recursive:true});
    for(const [path,value] of Object.entries(artifacts))writeFileSync(path,JSON.stringify(value,null,2)+'\n');
  }
  if(verify) {
    const normalize=value=>JSON.parse(JSON.stringify(value,(key,v)=>key==='elapsedMs'?undefined:v));
    for(const [path,value] of Object.entries(artifacts))assert.equal(canonicalJson(normalize(readJson(path))),canonicalJson(normalize(value)),`Stale research artifact: ${path}`);
  }
  return report;
}
import { solarExposure } from '../dist/core/solar.js';
function solarStart(input) {const s=initial(input);return solarExposure(s.aircraft.position,s.currentTimeUtc).q;}
