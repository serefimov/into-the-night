// SPDX-License-Identifier: GPL-3.0-only
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {geoArea} from 'd3-geo';

// See data/geography/SOURCE.md for the pinned source and offline simplification.
const expected='6e1e4214480663e22014a9dddac585c0e51b01f62d2746501468a7e0efa0b60e';
const input=await readFile(process.argv[2]);
if(createHash('sha256').update(input).digest('hex')!==expected)throw Error('Unexpected coastline input');
const source=JSON.parse(input),polygons=[];
for(const feature of source.features){
 const geometry=feature.geometry;
 if(geometry.type==='Polygon')polygons.push(geometry.coordinates);
 else if(geometry.type==='MultiPolygon')polygons.push(...geometry.coordinates);
 else throw Error('Expected polygon geometry');
}
// RFC 7946 export winding is opposite to d3's spherical convention.
for(const polygon of polygons){
 if(geoArea({type:'Polygon',coordinates:polygon})>2*Math.PI){
  for(const ring of polygon)ring.reverse();
 }
}
// Balance complete polygons: chunks never cut a ring or its holes.
const groups=Array.from({length:9},()=>[]),sizes=groups.map(()=>0);
for(const polygon of polygons.sort((a,b)=>JSON.stringify(b).length-JSON.stringify(a).length)){
 const i=sizes.indexOf(Math.min(...sizes));
 groups[i].push(polygon);sizes[i]+=JSON.stringify(polygon).length;
}
const parts=[];
for(const [i,group] of groups.entries()){
 const name=`coast-50m-${i+1}.json`;parts.push(name);
 await writeFile(`data/geography/${name}`,JSON.stringify(group)+'\n');
}
await writeFile('data/geography/land-50m.json',JSON.stringify({type:'MultiPolygon',parts},null,2)+'\n');
