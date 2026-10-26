// SPDX-License-Identifier: GPL-3.0-only
import {readFile} from 'node:fs/promises';
import {loadCampaignData} from './campaign-data.mjs';
export async function loadCycleDefinition(path='data/scenarios/westward-control-v2.json') {
 const config=JSON.parse(await readFile(path,'utf8')),data=await loadCampaignData();
 if(config.profileId!==data.profile.id||config.profileVersion!==data.profile.profileVersion||config.refuelingPolicy!=='route-before-departure-v2'||config.stockVersion!=='departure-stocks-v2'||config.scenarioVersion!==2||!Number.isFinite(config.stockKgPerAirport)||config.stockKgPerAirport<0)throw Error('Unsupported control profile, stock configuration or refuelling policy');
 if(config.catalogVersion!==data.catalog.catalogVersion||config.catalogSourceCommit!==data.catalog.source.commit)throw Error('Control airport catalogue differs');
 const stocks=Object.fromEntries(data.airports.map(a=>[a.id,config.stockKgPerAirport]));
 for(const [id,kg] of Object.entries(config.stockOverridesKg??{})){if(!Object.hasOwn(stocks,id)||!Number.isFinite(kg)||kg<0)throw Error('Invalid stock override');stocks[id]=kg;}
 return {scenarioId:config.scenarioId,scenarioVersion:config.scenarioVersion,seed:config.seed,stockVersion:config.stockVersion,worldVersion:`ourairports-v${config.catalogVersion}@${config.catalogSourceCommit}`,
  profile:data.profile,airports:data.airports,targetId:config.targetId,targetCompletion:config.targetCompletion,
  initial:{...config.initial,stocks}};
}
