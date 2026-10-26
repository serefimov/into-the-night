// SPDX-License-Identifier: GPL-3.0-only
import {mkdir,writeFile} from 'node:fs/promises';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
const definition=await loadCycleDefinition(),labels={SCEL:'Сантьяго',FACT:'Кейптаун',NZCH:'Крайстчерч',YPPH:'Перт',YSSY:'Сидней',YMML:'Мельбурн'};
definition.airports=definition.airports.map(a=>({id:a.id,name:a.name,label:labels[a.id]??a.name,iata:a.iata,country:a.country,latitudeDeg:a.latitudeDeg,longitudeDeg:a.longitudeDeg,suitability:{status:a.suitability.status}}));
await mkdir('data/runtime',{recursive:true});await writeFile('data/runtime/mission.json',JSON.stringify(definition)+'\n');
