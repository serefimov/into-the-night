// SPDX-License-Identifier: GPL-3.0-only
import {readFile} from 'node:fs/promises';
import {loadCampaignData} from './campaign-data.mjs';
export async function loadCycleDefinition(path='data/scenarios/academic-westward-v2.json') {
 const config=JSON.parse(await readFile(path,'utf8')),data=await loadCampaignData();
 if(config.profileId!==data.profile.id||config.profileVersion!==data.profile.profileVersion||config.refuelingPolicy!=='route-before-departure-v2'||config.stockVersion!=='departure-stocks-v2'||(config.chapterOne?config.scenarioVersion!==1:config.scenarioVersion!==2)||!Number.isFinite(config.stockKgPerAirport)||config.stockKgPerAirport<0)throw Error('Unsupported control profile, stock configuration or refuelling policy');
 if(config.catalogVersion!==data.catalog.catalogVersion||config.catalogSourceCommit!==data.catalog.source.commit)throw Error('Control airport catalogue differs');
 const stocks=Object.fromEntries(data.airports.map(a=>[a.id,config.stockKgPerAirport]));
 for(const [id,kg] of Object.entries(config.stockOverridesKg??{})){if(!Object.hasOwn(stocks,id)||!Number.isFinite(kg)||kg<0)throw Error('Invalid stock override');stocks[id]=kg;}
 let chapterOne;
 if(config.chapterOne){
  const {outboundSource,inboundSource,...ground}=JSON.parse(await readFile(config.chapterOne,'utf8'));
  const origin=data.airports.find(a=>a.id===ground.airportId),point={latitudeDeg:origin.latitudeDeg,longitudeDeg:origin.longitudeDeg};
  const path=async source=>JSON.parse(await readFile(source,'utf8')).geometry.coordinates.map(([longitudeDeg,latitudeDeg])=>({latitudeDeg,longitudeDeg}));
  const outbound=await path(outboundSource),inbound=await path(inboundSource);
  const distinct=points=>points.filter((p,i)=>!i||p.latitudeDeg!==points[i-1].latitudeDeg||p.longitudeDeg!==points[i-1].longitudeDeg);
  chapterOne={...ground,outbound:distinct([point,...outbound]),inbound:distinct([...inbound,point])};
 }
 return {...(chapterOne?{chapterOne}:{}),scenarioId:config.scenarioId,scenarioVersion:config.scenarioVersion,seed:config.seed,stockVersion:config.stockVersion,worldVersion:`ourairports-v${config.catalogVersion}@${config.catalogSourceCommit}`,
  profile:data.profile,airports:data.airports,targetId:config.targetId,targetCompletion:config.targetCompletion,
  initial:{...config.initial,stocks}};
}
