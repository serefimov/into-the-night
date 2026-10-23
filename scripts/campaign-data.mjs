// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadMissionData,validateCatalog,generateFuel} from './mission-data.mjs';
export const loadCampaignData=()=>loadMissionData('data/campaign','data/mission/aircraft.json');
export async function writeCampaignData(importPath='.build/campaign-import/airports.json') {
 const {airports,...metadata}=JSON.parse(await readFile(importPath,'utf8')),regions=[];
 const write=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
 await mkdir('data/campaign/airports',{recursive:true});
 for(const continent of [...new Set(airports.map(a=>a.continent))].sort()) {
  const entries=airports.filter(a=>a.continent===continent).sort((a,b)=>a.id.localeCompare(b.id));
  for(let i=0;i<entries.length;i+=20) {
   const region=continent+'-'+(i/20+1);regions.push(region);await write('data/campaign/airports/'+region+'.json',entries.slice(i,i+20));
  }
 }
 await write('data/campaign/catalog.json',{...metadata,regions});
 await write('data/campaign/fuel.json',generateFuel(airports,'academic-campaign-research-v1'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.includes('--write'))await writeCampaignData();
 const data=await loadCampaignData();console.log(JSON.stringify(validateCatalog(data.catalog,data.airports,data.fuel,data.profile),null,2));
}
