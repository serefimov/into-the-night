// SPDX-License-Identifier: GPL-3.0-only
import {readFile} from 'node:fs/promises';
import {loadCampaignData} from './campaign-data.mjs';
export async function loadCycleDefinition(path='data/scenarios/westward-control.json') {
 const config=JSON.parse(await readFile(path,'utf8')),data=await loadCampaignData();
 if(config.profileId!==data.profile.id||config.profileVersion!==data.profile.profileVersion||config.stockVersion!=='fixed-32000-research-1'||config.stockKgPerAirport!==32000)throw Error('Unsupported control profile or stock configuration');
 if(config.catalogVersion!==data.catalog.catalogVersion||config.catalogSourceCommit!==data.catalog.source.commit)throw Error('Control airport catalogue differs');
 return {scenarioId:config.scenarioId,scenarioVersion:config.scenarioVersion,seed:config.seed,stockVersion:config.stockVersion,worldVersion:`ourairports-v${config.catalogVersion}@${config.catalogSourceCommit}`,
  profile:data.profile,airports:data.airports,targetId:config.targetId,targetCompletion:config.targetCompletion,
  initial:{...config.initial,stocks:Object.fromEntries(data.airports.map(a=>[a.id,config.stockKgPerAirport]))}};
}
