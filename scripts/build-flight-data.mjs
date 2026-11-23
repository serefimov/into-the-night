// SPDX-License-Identifier: GPL-3.0-only
import {mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
const definition=await loadCycleDefinition('data/scenarios/chapter-one-v1.json'),legacy=await loadCycleDefinition(),fleet=await loadCycleDefinition('data/scenarios/aircraft-transfer-v1.json'),labels={ULLI:'Санкт-Петербург',UNNT:'Новосибирск',UACC:'Астана',BIKF:'Кефлавик',CYEG:'Эдмонтон',CYYC:'Калгари',CYWG:'Виннипег',UHMA:'Анадырь',UHPP:'Петропавловск-Камчатский',UHHH:'Хабаровск',UHSS:'Южно-Сахалинск',ENGM:'Осло',EIDW:'Дублин',EGCC:'Манчестер',ESSA:'Стокгольм',EKCH:'Копенгаген',EDDH:'Гамбург',SCEL:'Сантьяго',FACT:'Кейптаун',NZCH:'Крайстчерч',YPPH:'Перт',YSSY:'Сидней',YMML:'Мельбурн'};
const browserAirports=(airports,names=labels)=>airports.map(a=>({id:a.id,name:a.name,label:names[a.id]??a.name,iata:a.iata,country:a.country,latitudeDeg:a.latitudeDeg,longitudeDeg:a.longitudeDeg,suitability:{status:a.suitability.status}}));
definition.airports=browserAirports(definition.airports);
legacy.airports=definition.airports;
fleet.airports=browserAirports(fleet.airports,{...labels,ROAH:'Наха',RORH:'Хатерума',ZGGG:'Гуанчжоу'});
await mkdir('data/runtime',{recursive:true});await writeFile('data/runtime/mission.json',JSON.stringify(definition)+'\n');
await writeFile('data/runtime/airport-spike.json',JSON.stringify(legacy)+'\n');
await writeFile('data/runtime/aircraft-transfer.json',JSON.stringify(fleet)+'\n');
// Serve pinned local ESM sources and their licences, without a CDN or a bundler.
await rm('data/runtime/vendor',{recursive:true,force:true});
for (const name of ['d3-geo','d3-array','internmap']) {
 const destination=`data/runtime/vendor/${name}`;
 await mkdir(destination,{recursive:true});
 await cp(`node_modules/${name}/src`,destination,{recursive:true});
 await cp(`node_modules/${name}/LICENSE`,`${destination}/LICENSE`);
}
