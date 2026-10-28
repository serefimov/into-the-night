// SPDX-License-Identifier: GPL-3.0-only
import {mkdir,writeFile,cp,rm} from 'node:fs/promises';
import {loadCycleDefinition} from './mission-cycle-data.mjs';
const definition=await loadCycleDefinition('data/scenarios/chapter-one-v1.json'),legacy=await loadCycleDefinition(),labels={ULLI:'Санкт-Петербург',UNNT:'Новосибирск',BIKF:'Кефлавик',CYEG:'Эдмонтон',CYYC:'Калгари',CYWG:'Виннипег',UHMA:'Анадырь',UHPP:'Петропавловск-Камчатский',UHHH:'Хабаровск',UHSS:'Южно-Сахалинск',ENGM:'Осло',EIDW:'Дублин',EGCC:'Манчестер',ESSA:'Стокгольм',EKCH:'Копенгаген',EDDH:'Гамбург',SCEL:'Сантьяго',FACT:'Кейптаун',NZCH:'Крайстчерч',YPPH:'Перт',YSSY:'Сидней',YMML:'Мельбурн'};
definition.airports=definition.airports.map(a=>({id:a.id,name:a.name,label:labels[a.id]??a.name,iata:a.iata,country:a.country,latitudeDeg:a.latitudeDeg,longitudeDeg:a.longitudeDeg,suitability:{status:a.suitability.status}}));
legacy.airports=definition.airports;
await mkdir('data/runtime',{recursive:true});await writeFile('data/runtime/mission.json',JSON.stringify(definition)+'\n');
await writeFile('data/runtime/airport-spike.json',JSON.stringify(legacy)+'\n');
// Serve pinned local ESM sources and their licences, without a CDN or a bundler.
await rm('data/runtime/vendor',{recursive:true,force:true});
for (const name of ['d3-geo','d3-array','internmap']) {
 const destination=`data/runtime/vendor/${name}`;
 await mkdir(destination,{recursive:true});
 await cp(`node_modules/${name}/src`,destination,{recursive:true});
 await cp(`node_modules/${name}/LICENSE`,`${destination}/LICENSE`);
}
