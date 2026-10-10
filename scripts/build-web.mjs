import {mkdir,cp,rm,writeFile} from 'node:fs/promises';
await rm('.build/spike',{recursive:true,force:true});
await mkdir('.build/spike',{recursive:true});
for(const path of ['web','dist/core','data/spike','docs/SPIKE_SCENARIO.md'])await cp(path,`.build/spike/${path}`,{recursive:true});
await writeFile('.build/spike/index.html','<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./web/index.html"><title>Into the Night</title></head><body><a href="./web/index.html">Открыть игру</a></body></html>\n');
process.stdout.write('Browser build: .build/spike (serve with npm run serve:web)\n');
