import {mkdir,cp,rm} from 'node:fs/promises';
await rm('.build/spike',{recursive:true,force:true});
await mkdir('.build/spike',{recursive:true});
for(const path of ['web','dist/core','data/spike','docs/SPIKE_SCENARIO.md'])await cp(path,`.build/spike/${path}`,{recursive:true});
process.stdout.write('Browser build: .build/spike (serve with npm run serve:web)\n');
