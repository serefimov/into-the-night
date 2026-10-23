// SPDX-License-Identifier: GPL-3.0-only
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {aircraftMetrics,validateAircraftProfile} from '../src/core/aircraft.ts';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const write=(path,data)=>writeFile(path,JSON.stringify(data,null,2)+'\n');
export function generateFuel(airports,seed='jfk-heathrow-research-v1') {
 if(typeof seed!=='string'||!seed)throw Error('Invalid fuel seed');
 return {stockVersion:1,seed,units:'kg',public:true,regeneration:false,provenance:'Experimental finite game stocks, not airport inventory facts',stocks:Object.fromEntries([...airports].sort((a,b)=>a.id.localeCompare(b.id)).map(a=>[a.id,100000+(createHash('sha256').update(seed+'\0'+a.ourAirportsId).digest().readUInt32BE(0)%301)*1000]))};
}
export function validateCatalog(catalog,airports,fuel,profile) {
 validateAircraftProfile(profile);
 if(![1,2].includes(catalog.catalogVersion)||catalog.source.license!=='Public Domain'||!/^[a-f0-9]{40}$/.test(catalog.source.commit)||!/^\d{4}-\d{2}-\d{2}$/.test(catalog.retrievedDate)||!Number.isFinite(Date.parse(catalog.retrievedDate)))throw Error('Invalid catalogue provenance');
 const seen=new Set(),sourceIds=new Set();
 for(const a of airports) {
  if(typeof a.id!=='string'||!a.id||seen.has(a.id)||!Number.isInteger(a.ourAirportsId)||sourceIds.has(a.ourAirportsId))throw Error('Duplicate/invalid airport ID');seen.add(a.id);sourceIds.add(a.ourAirportsId);
  if(!a.name||a.sourceId!=='ourairports'||!Number.isFinite(a.latitudeDeg)||Math.abs(a.latitudeDeg)>90||!Number.isFinite(a.longitudeDeg)||Math.abs(a.longitudeDeg)>180)throw Error('Invalid airport coordinates/source');
  if(!Array.isArray(a.runways)||a.suitability.operationalApproval!==false)throw Error('Unsupported airport approval');
  // Empty source surface means unknown; it must never pass the paved-runway screen below.
  for(const r of a.runways)if(!Number.isInteger(r.sourceRowId)||!Number.isFinite(r.lengthM)||r.lengthM<=0||!Number.isFinite(r.widthM)||r.widthM<=0||typeof r.surface!=='string')throw Error('Invalid runway');
  if(!['screened-candidate','unverified'].includes(a.suitability.status))throw Error('Invalid suitability status');
  if(a.suitability.status==='screened-candidate'&&!a.runways.some(r=>r.lengthM>=profile.assumptions.runwayScreenLengthM&&r.widthM>=profile.assumptions.runwayScreenWidthM&&/ASP|CON|BIT|PEM/.test(r.surface.toUpperCase())))throw Error('Runway screening contradiction');
 }
 if(!seen.has('KJFK')||!seen.has('EGLL'))throw Error('Mission endpoints missing');
 if(fuel.stockVersion!==1||fuel.units!=='kg'||fuel.public!==true||fuel.regeneration!==false||Object.keys(fuel.stocks).length!==seen.size)throw Error('Invalid stock metadata/coverage');
 for(const [id,kg] of Object.entries(fuel.stocks))if(!seen.has(id)||typeof kg!=='number'||!Number.isFinite(kg)||kg<0)throw Error('Invalid fuel stock');
 if(JSON.stringify(generateFuel(airports,fuel.seed))!==JSON.stringify(fuel))throw Error('Stocks differ from seed');
 const continents=new Set(airports.map(a=>a.continent));for(const c of ['AF','AS','EU','NA','OC','SA'])if(!continents.has(c))throw Error('World coverage missing: '+c);
 return {airports:airports.length,screenedCandidates:airports.filter(a=>a.suitability.status==='screened-candidate').length,unverified:airports.filter(a=>a.suitability.status==='unverified').map(a=>a.id),continents:[...continents].sort(),aircraft:aircraftMetrics(profile),missionFeasibility:'not-evaluated'};
}
export async function loadMissionData(root='data/mission',profilePath=resolve(root,'aircraft.json')) {
 const catalog=await read(resolve(root,'catalog.json'));
 if(!Array.isArray(catalog.regions)||new Set(catalog.regions).size!==catalog.regions.length||catalog.regions.some(r=>!/^(AF|AS|EU|NA|OC|SA)(?:-[1-9][0-9]*)?$/.test(r)))throw Error('Invalid catalogue region path');
 const airports=(await Promise.all(catalog.regions.map(r=>read(resolve(root,'airports',r+'.json'))))).flat().sort((a,b)=>a.id.localeCompare(b.id));
 return {catalog,airports,fuel:await read(resolve(root,'fuel.json')),profile:await read(profilePath)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 if(process.argv.includes('--write')) {
  const {airports,...metadata}=await read('.build/mission-import/airports.json'),regions=[...new Set(airports.map(a=>a.continent))].sort();await mkdir('data/mission/airports',{recursive:true});
  for(const region of regions)await write(`data/mission/airports/${region}.json`,airports.filter(a=>a.continent===region));
  await write('data/mission/catalog.json',{...metadata,regions});await write('data/mission/fuel.json',generateFuel(airports));
 }
 const data=await loadMissionData();console.log(JSON.stringify(validateCatalog(data.catalog,data.airports,data.fuel,data.profile),null,2));
}
