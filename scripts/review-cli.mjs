import {readFileSync} from 'node:fs';
import {SpikeGame} from '../dist/core/game.js';
import {canonicalJson} from '../dist/core/saves.js';
try {
 if(process.argv.length!==3)throw Error('Use review-cli.mjs JOURNAL.json');
 const read=p=>JSON.parse(readFileSync(p,'utf8')),journal=read(process.argv[2]);
 const game=new SpikeGame(read('data/spike/airports.json'),read('data/spike/scenario.json'));
 if(journal.journalVersion!==1 || !Array.isArray(journal.entries))throw Error('Invalid journal version/entries.');
 for(const entry of journal.entries){
  if(game.current().currentTimeUtc!==entry.startUtcMs)throw Error('Noncontiguous journal.');
  game.start(entry.actions,entry.confirmRisk);
  if(game.active)game.advance(entry.stopUtcMs);
  if(entry.cancelGround)game.cancelGround();
 }
 if(canonicalJson(game.journal())!==canonicalJson(journal))throw Error('Replay differs from exported journal.');
 process.stdout.write(JSON.stringify({passed:true,state:game.current(),entries:journal.entries.length},null,2)+'\n');
}catch(e){process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exitCode=2;}
