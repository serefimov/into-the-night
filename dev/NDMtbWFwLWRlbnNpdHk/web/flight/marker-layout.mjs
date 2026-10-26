// SPDX-License-Identifier: GPL-3.0-only
import {globePoint} from '../../dist/core/globe.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const box=(p,r=22)=>({left:p.x-r,right:p.x+r,top:p.y-r,bottom:p.y+r});
/** Screen layout only: every projected airport remains in one selectable group.
 * Neither forecast status nor visibility decides which airports exist in the mission. */
export function layoutAirportMarkers({airports,frame,width,height,zoom,priorityIds=[],obstacles=[],plane=null}) {
 const detail=zoom>=2.2,area=Math.min(width*height,Math.PI*frame.radius**2);
 const budget=Math.max(detail?12:7,Math.min(detail?56:24,Math.floor(area/(detail?9000:22000))));
 const priorities=new Map();for(const id of priorityIds)if(id&&!priorities.has(id))priorities.set(id,priorities.size);
 const projected=airports.map(airport=>({...globePoint(airport,frame),id:airport.id,airport})).filter(p=>p.depth>=.025&&p.x>=22&&p.x<=width-22&&p.y>=22&&p.y<=height-22);
 const inside=p=>p.x>=22&&p.x<=width-22&&p.y>=22&&p.y<=height-22;
 const clear=(p,placed,protectPlane=true)=>inside(p)&&!obstacles.some(r=>intersects(box(p),r))&&!placed.some(q=>distance(p,q)<44)&&(!protectPlane||!plane?.visible||distance(p,plane)>=36);
 const pins=projected.filter(p=>priorities.has(p.id)).sort((a,b)=>priorities.get(a.id)-priorities.get(b.id)),ordinary=projected.filter(p=>!priorities.has(p.id)).sort((a,b)=>a.id.localeCompare(b.id));
 const rows=[];
 for(const p of pins){
  const candidates=[p];
  for(let radius=44;radius<=176;radius+=44)for(let i=0;i<16;i++){const angle=i*Math.PI/8;candidates.push({x:p.x+Math.cos(angle)*radius,y:p.y+Math.sin(angle)*radius});}
  const at=candidates.find(q=>clear(q,rows,false))??p;
  rows.push({...p,x:at.x,y:at.y,anchorX:p.x,anchorY:p.y,priority:true,group:[p]});
 }
 const ungrouped=[];
 for(const p of ordinary){const pin=rows.find(q=>Math.hypot(p.x-q.anchorX,p.y-q.anchorY)<44);if(pin)pin.group.push(p);else ungrouped.push(p);}
 const slots=Math.max(1,budget-rows.length);let groups=[],spacing=detail?44:76;
 // Expand spatial grouping until its size fits the viewport. Status updates never
 // reshuffle anchors; zooming/panning reveals the complete underlying groups.
 for(;;){groups=[];for(const p of ungrouped){const g=groups.find(g=>distance(p,g[0])<spacing);if(g)g.push(p);else groups.push([p]);}if(groups.length<=slots)break;spacing*=1.2;}
 for(const group of groups){
  const at=group.find(p=>clear(p,rows));
  if(at)rows.push({...at,anchorX:at.x,anchorY:at.y,priority:false,group});
  else if(rows.length){const near=rows.reduce((a,b)=>distance(group[0],a)<distance(group[0],b)?a:b);near.group.push(...group);}
  // A fully occluded empty viewport has no usable marker location. Its airports
  // reappear after navigation; the catalog and worker are never filtered here.
 }
 for(const row of rows){row.cluster=row.group.length>1;row.count=row.group.length;}
 const labels=[],labelLimit=detail?Math.min(18,Math.max(4,Math.floor(width*height/36000))):0;
 let ordinaryLabels=0;
 for(const row of rows){
  if(!row.priority&&(row.cluster||ordinaryLabels>=labelLimit))continue;
  const label=row.priority?(row.airport.label??row.airport.iata??row.id):(row.airport.iata??row.id),w=Math.min(125,label.length*6.2+4),h=15;
  const candidates=[{left:row.x-w/2,top:row.y+17},{left:row.x-w/2,top:row.y-32},{left:row.x+19,top:row.y-h/2},{left:row.x-w-19,top:row.y-h/2}].map(p=>({...p,right:p.left+w,bottom:p.top+h}));
  const rect=candidates.find(r=>r.left>=4&&r.right<=width-4&&r.top>=4&&r.bottom<=height-4&&!obstacles.some(o=>intersects(r,o))&&!labels.some(o=>intersects(r,o))&&!rows.some(p=>p!==row&&intersects(r,box(p,17)))&&(!plane?.visible||!intersects(r,box(plane,17))));
  if(rect){row.label={text:label,...rect};labels.push(rect);if(!row.priority)ordinaryLabels++;}
 }
 return {rows,budget,detail,projectedCount:projected.length};
}
