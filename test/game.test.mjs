import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SpikeGame} from '../dist/core/game.js';
import {mapRoute} from '../dist/core/map.js';
import {generateScenario} from '../dist/core/scenario.js';
import {createSimulation,executePlan,visibleState} from '../dist/core/simulation.js';
import {canonicalJson,saveChecksum} from '../dist/core/saves.js';
const read=p=>JSON.parse(readFileSync(p,'utf8')),catalog=read('data/spike/airports.json'),scenario=read('data/spike/scenario.json');
const fresh=()=>new SpikeGame(catalog,scenario);
function finish(game,actions,confirm=false){game.start(actions,confirm);if(game.active)game.advance(game.endUtcMs);}
test('Planning and future landing do not consume UTC or reveal true destination stocks',()=>{
 const game=fresh(),before=game.save(),flight=game.flight('LYR');
 assert.equal(flight.forecast.outcome,'completed');assert.equal(game.save(),before);
 const view=game.preview(flight.actions,flight.arrivalUtcMs);
 assert.equal(view.state.currentTimeUtc,flight.arrivalUtcMs);assert.deepEqual(view.state.warehouses.LYR.foodPersonHours,[72000,79200]);
 assert.equal(game.save(),before);assert.deepEqual(view.state.discovered,['OSL']);
});
test('Invalid loads/fuel and unconfirmed fatal waiting do not start or mutate the game',()=>{
 const game=fresh(),before=game.save();
 for(const actions of [[{kind:'load',fuelKg:9000,foodPersonHours:0}],[{kind:'load',fuelKg:-1,foodPersonHours:0}],[{kind:'wait',seconds:86400}]]) {
  assert.throws(()=>game.start(actions));assert.equal(game.save(),before);assert.equal(game.active,false);
 }
 const small=new SpikeGame(catalog,{...scenario,aircraft:{fuelKg:1,foodPersonHours:1080}});
 assert.equal(small.flight('LYR').forecast.outcome,'validation_error');assert.throws(()=>small.start(small.flight('LYR').actions));
});
test('Game loading/flight matches the CLI kernel; save in flight, restore and finish are exact',()=>{
 const game=fresh(),load=[{kind:'load',fuelKg:600,foodPersonHours:360}];finish(game,load);
 const {world,stocks}=generateScenario(catalog,scenario);
 let expected=createSimulation(world,stocks,Date.parse(scenario.utc),scenario.airportId,scenario.aircraft);
 expected=executePlan(world,expected,load).state;
 const actions=game.flight('LYR').actions;
 const complete=executePlan(world,expected,actions);
 game.start(actions);game.advance(game.current().currentTimeUtc+1200000);
 assert.equal(game.current().aircraft.airportId,null);assert.throws(()=>game.cancelGround());
 const save=game.save(),restored=fresh();restored.restore(save);assert.equal(restored.save(),save);
 restored.advance(restored.endUtcMs);game.advance(game.endUtcMs);
 assert.deepEqual(game.current(),visibleState(world,complete.state));assert.equal(restored.save(),game.save());
 assert.deepEqual(restored.journal(),game.journal());
});
test('Pause/cancel a month stay at 15 days, save and continue preserves consumed stores and event history',()=>{
 const game=fresh();finish(game,game.flight('LYR').actions);finish(game,[{kind:'service'}]);
 const start=game.current().currentTimeUtc,original=game.current().warehouses.LYR.foodPersonHours;
 game.start([{kind:'wait',seconds:30*86400}]);game.advance(start+15*86400000);
 assert.equal(game.current().currentTimeUtc,start+15*86400000);
 assert.ok(Math.abs(game.current().warehouses.LYR.foodPersonHours-(original-15*720))<1e-6);
 const paused=game.save(),restored=fresh();restored.restore(paused);assert.equal(restored.save(),paused);
 restored.cancelGround();assert.equal(restored.current().phase,'planning');
 finish(restored,[{kind:'wait',seconds:15*86400}]);game.advance(game.endUtcMs);
 assert.deepEqual(restored.current(),game.current());
 const again=fresh();again.restore(restored.save());assert.deepEqual(again.journal(),restored.journal());
});
test('Interrupted loading keeps its transfer; incomplete preparation/service never sets completed flags',()=>{
 const game=fresh(),fuel=game.current().aircraft.fuelKg;
 game.start([{kind:'load',fuelKg:600,foodPersonHours:0}]);game.advance(game.current().currentTimeUtc+90000);game.cancelGround();
 assert.ok(Math.abs(game.current().aircraft.fuelKg-fuel-300)<1e-6);
 game.start([{kind:'prepare'}]);game.advance(game.current().currentTimeUtc+450000);game.cancelGround();
 assert.equal(game.current().departurePrepared,false);
 finish(game,game.flight('LYR').actions);
 game.start([{kind:'service'}]);game.advance(game.current().currentTimeUtc+450000);game.cancelGround();
 assert.equal(game.current().serviceRequired,true);
});
test('Automatic waiting stops at seasonal warning and zero-duration repeats remain savable',()=>{
 const game=fresh();finish(game,game.flight('LYR').actions);finish(game,[{kind:'service'}]);
 finish(game,[{kind:'auto_wait'}]);assert.deepEqual(game.current().waitingWarning.reasons,['sunrise_warning']);
 const now=game.current().currentTimeUtc;game.start([{kind:'auto_wait'}]);assert.equal(game.active,false);assert.equal(game.current().currentTimeUtc,now);
 const restored=fresh();restored.restore(game.save());assert.deepEqual(restored.journal(),game.journal());
 assert.throws(()=>game.start([{kind:'wait',seconds:1}]));
});
test('A damaged or noncontiguous save does not replace the active game, even with a recomputed checksum',()=>{
 const game=fresh();finish(game,[{kind:'prepare'}]);const before=game.save(),bad=JSON.parse(before);
 bad.payload.metadata.seed='wrong';bad.checksum=saveChecksum(bad.payload);assert.throws(()=>game.restore(JSON.stringify(bad)));assert.equal(game.save(),before);
 const duplicate=JSON.parse(before);duplicate.payload.records.push(duplicate.payload.records[0]);duplicate.checksum=saveChecksum(duplicate.payload);
 assert.throws(()=>game.restore(JSON.stringify(duplicate)));assert.equal(game.save(),before);
});
test('Map routes use the shared orthodromy and never draw a line across the dateline seam',()=>{
 const dateline=mapRoute({latitudeDeg:10,longitudeDeg:170},{latitudeDeg:10,longitudeDeg:-170});
 assert.equal(dateline.length,2);
 for(const line of dateline)for(let i=1;i<line.length;i++)assert.ok(Math.abs(line[i].longitudeDeg-line[i-1].longitudeDeg)<=180);
 const polar=mapRoute({latitudeDeg:80,longitudeDeg:-90},{latitudeDeg:80,longitudeDeg:90});
 assert.ok(polar.flat().some(p=>p.latitudeDeg>89.99));
 assert.equal(canonicalJson(dateline),canonicalJson(mapRoute({latitudeDeg:10,longitudeDeg:170},{latitudeDeg:10,longitudeDeg:-170})));
});
