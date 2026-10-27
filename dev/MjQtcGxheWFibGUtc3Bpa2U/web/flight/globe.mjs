// SPDX-License-Identifier: GPL-3.0-only
import {globeFrame,globeNormal,globeLines,globeRoute} from '../../dist/core/globe.js';
import {layoutAirportMarkers} from './marker-layout.mjs';
import {flightPlanePose,drawFlightPlane} from './plane.mjs';
import {solarDirection} from '../../dist/core/solar.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const longitude=v=>((v+180)%360+360)%360-180;
const colors={nightLand:[28,56,61],nightSea:[8,22,34],dayLand:[127,163,158],daySea:[29,64,79]};
export class GlobeView {
 constructor(canvas,markers,land,{onSelect,onInteraction}) {
  this.canvas=canvas;this.markers=markers;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.onInteraction=onInteraction;
  this.camera={latitudeDeg:-42,longitudeDeg:-140,zoom:1};this.pointers=new Map();this.nodes=new Map();this.hits=[];this.data=null;this.dirty=true;this.geometry=null;
  this.texture=document.createElement('canvas');this.texture.width=1024;this.texture.height=512;const ctx=this.texture.getContext('2d');
  ctx.fillStyle='#fff';ctx.strokeStyle='#fff';ctx.lineWidth=.6;
  for(const polygon of land.coordinates){ctx.beginPath();for(const ring of polygon){ring.forEach(([lon,lat],i)=>{const x=(lon+180)/360*1024,y=(90-lat)/180*512;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();}ctx.fill('evenodd');ctx.stroke();}
  this.landPixels=ctx.getImageData(0,0,1024,512).data;this.surface=document.createElement('canvas');
  this.picker=document.createElement('div');this.picker.className='cluster-picker';this.picker.hidden=true;canvas.parentElement.append(this.picker);
  this.resizeObserver=new ResizeObserver(()=>{this.geometry=null;this.dirty=true;});this.resizeObserver.observe(canvas);
  canvas.addEventListener('pointerdown',e=>this.down(e));canvas.addEventListener('pointermove',e=>this.move(e));canvas.addEventListener('pointerup',e=>this.up(e));
  canvas.addEventListener('pointercancel',e=>{this.pointers.delete(e.pointerId);this.gestureMoved=true;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();this.onInteraction();this.zoom(Math.exp(-e.deltaY*.0015));},{passive:false});
  canvas.addEventListener('keydown',e=>{const step={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,10],ArrowDown:[0,-10]}[e.key];
   if(step){e.preventDefault();this.onInteraction();this.camera.longitudeDeg=longitude(this.camera.longitudeDeg+step[0]);this.camera.latitudeDeg=clamp(this.camera.latitudeDeg+step[1],-90,90);this.invalidate();}
   if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();this.onInteraction();this.zoom(e.key==='-' ? .8 : 1.25);}
  });
 }
 invalidate(){this.geometry=null;this.dirty=true;}
 focus(location,zoom=this.camera.zoom){this.picker.hidden=true;this.camera={latitudeDeg:location.latitudeDeg,longitudeDeg:location.longitudeDeg,zoom:clamp(zoom,.75,5)};this.invalidate();}
 zoom(factor){this.picker.hidden=true;this.camera.zoom=clamp(this.camera.zoom*factor,.75,5);this.invalidate();}
 update(data){this.data=data;this.dirty=true;}
 pointer(e){const r=this.canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};}
 down(e){if(e.pointerType==='mouse'&&e.button!==0)return;this.picker.hidden=true;this.canvas.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{...this.pointer(e),start:this.pointer(e)});
  if(this.pointers.size===1)this.gestureMoved=false;else this.gestureMoved=true;this.onInteraction();}
 move(e){const old=this.pointers.get(e.pointerId);if(!old)return;const point=this.pointer(e),before=[...this.pointers.values()];
  if(this.pointers.size===2){const distance=a=>Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),previous=distance(before);this.pointers.set(e.pointerId,{...point,start:old.start});const current=distance([...this.pointers.values()]);if(previous>0)this.zoom(current/previous);this.gestureMoved=true;return;}
  const dx=point.x-old.x,dy=point.y-old.y;if(Math.hypot(point.x-old.start.x,point.y-old.start.y)>8)this.gestureMoved=true;
  if(this.gestureMoved){const sensitivity=180/(Math.PI*(this.frame?.radius??150));this.camera.longitudeDeg=longitude(this.camera.longitudeDeg-dx*sensitivity);this.camera.latitudeDeg=clamp(this.camera.latitudeDeg+dy*sensitivity,-90,90);this.invalidate();}
  this.pointers.set(e.pointerId,{...point,start:old.start});
 }
 up(e){if(!this.pointers.has(e.pointerId))return;const point=this.pointer(e),single=this.pointers.size===1;this.pointers.delete(e.pointerId);
  if(!single||this.gestureMoved)return;
  const hit=this.hits.filter(h=>Math.hypot(h.x-point.x,h.y-point.y)<=22).sort((a,b)=>Math.hypot(a.x-point.x,a.y-point.y)-Math.hypot(b.x-point.x,b.y-point.y))[0];
  if(hit)this.activate(hit);
 }
 activate(hit){if(!hit.cluster){this.picker.hidden=true;this.onSelect(hit.id);return;}
  if(this.camera.zoom<4.8){this.focus(hit.airport,this.camera.zoom*1.7);return;}
  this.picker.replaceChildren();this.picker.style.left=clamp(hit.x-110,12,this.geometry.width-232)+'px';this.picker.style.top=clamp(hit.y+20,80,this.geometry.height-180)+'px';
  for(const row of hit.group){const button=document.createElement('button');button.textContent=row.airport.label??row.airport.name??row.id;button.dataset.airportId=row.id;button.addEventListener('click',()=>{this.picker.hidden=true;this.onSelect(row.id);});this.picker.append(button);}this.picker.hidden=false;
 }
 prepare(width,height) {
  const scale=Math.min(1,560/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  this.surface.width=w;this.surface.height=h;const frame=globeFrame(this.camera,w,h,this.camera.zoom),ctx=this.surface.getContext('2d'),image=ctx.createImageData(w,h),samples=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=globeNormal(x+.5,y+.5,frame);if(!n)continue;
   const lon=Math.atan2(n[1],n[0]),lat=Math.asin(clamp(n[2],-1,1)),tx=clamp(Math.floor((lon/Math.PI+1)*512),0,1023),ty=clamp(Math.floor((.5-lat/Math.PI)*512),0,511);
   samples.push({index:(y*w+x)*4,n,land:this.landPixels[(ty*1024+tx)*4+3]>90,depth:Math.sqrt(Math.max(0,1-((x+.5-frame.cx)**2+(y+.5-frame.cy)**2)/frame.radius**2))});
  }
  this.geometry={width,height,ctx,image,samples};
 }
 draw(utcMs) {
  if(!this.data)return;
  this.lastUtcMs=utcMs;
  const r=this.canvas.getBoundingClientRect(),width=r.width,height=r.height;if(width<1||height<1)return;
  const dpr=Math.min(devicePixelRatio||1,2);if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)){this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);this.geometry=null;}
  this.frame=globeFrame(this.camera,width,height,this.camera.zoom);
  if(!this.geometry||this.geometry.width!==width||this.geometry.height!==height)this.prepare(width,height);
  const sun=solarDirection(utcMs),g=this.geometry;
  for(const {index,n,land,depth} of g.samples){const q=n[0]*sun[0]+n[1]*sun[1]+n[2]*sun[2],day=clamp((q+.025)/.05,0,1),shade=.6+.4*depth;
   const night=land?colors.nightLand:colors.nightSea,light=land?colors.dayLand:colors.daySea;
   for(let c=0;c<3;c++)g.image.data[index+c]=Math.round((night[c]+(light[c]-night[c])*day)*shade);g.image.data[index+3]=255;
  }
  g.ctx.putImageData(g.image,0,0);const ctx=this.ctx;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.drawImage(this.surface,0,0,width,height);
  ctx.strokeStyle='#5b8d9355';ctx.lineWidth=1;ctx.beginPath();ctx.arc(this.frame.cx,this.frame.cy,this.frame.radius,0,Math.PI*2);ctx.stroke();
  const stroke=(points,color,lineWidth=1,dash=[])=>{ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.setLineDash(dash);for(const line of globeLines(points,this.frame)){ctx.beginPath();line.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}ctx.setLineDash([]);};
  for(let lat=-60;lat<=60;lat+=30)stroke(Array.from({length:73},(_,i)=>({latitudeDeg:lat,longitudeDeg:i*5-180})),'#68919220');
  for(let lon=-180;lon<180;lon+=30)stroke(Array.from({length:37},(_,i)=>({latitudeDeg:i*5-90,longitudeDeg:lon})),'#68919220');
  for(const path of this.data.tracks??[])stroke(globeRoute(path.from,path.to),'#debd8155',2);
  const forecast=this.data.forecast;
  if(forecast){const cruise=forecast.phases.find(p=>p.label==='cruise');if(cruise)stroke(globeRoute(cruise.route.path.from,cruise.route.path.to),forecast.allowed?'#e7c58c':'#ef847e',2.5,forecast.allowed?[]:[5,5]);}
  this.planePose=flightPlanePose(this.data.state,this.data.acceptedForecast,this.frame);
  this.drawMarkers();drawFlightPlane(ctx,this.planePose);
  this.dirty=false;
 }
 drawMarkers() {
  const {airports,state,selectedId,targetId,statuses}=this.data,canvasRect=this.canvas.getBoundingClientRect();
  const obstacles=[...this.canvas.parentElement.querySelectorAll('.map-controls,.map-legend,.world-caption,.playback,.map-detail-hint,#plane-focus'),document.getElementById('goal-focus')].filter(e=>e&&!e.hidden&&e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return {left:r.left-canvasRect.left-5,right:r.right-canvasRect.left+5,top:r.top-canvasRect.top-5,bottom:r.bottom-canvasRect.top+5};});
  const plane=this.planePose,active=state.activeFlight;
  this.markerLayout=layoutAirportMarkers({airports,frame:this.frame,width:this.geometry.width,height:this.geometry.height,zoom:this.camera.zoom,priorityIds:[selectedId,state.airportId,targetId,active?.fromId,active?.toId],obstacles,plane});
  const {rows,detail}=this.markerLayout;
  for(const row of rows)if(Math.hypot(row.x-row.anchorX,row.y-row.anchorY)>1){this.ctx.strokeStyle='#c4cfc280';this.ctx.lineWidth=1;this.ctx.beginPath();this.ctx.moveTo(row.anchorX,row.anchorY);this.ctx.lineTo(row.x,row.y);this.ctx.stroke();}
  this.hits=rows;const live=new Set();
  for(const row of rows){live.add(row.id);let node=this.nodes.get(row.id);
   if(!node){node=document.createElement('button');node.type='button';node.className='map-marker';node.addEventListener('click',()=>this.activate(this.hits.find(h=>h.id===row.id)??row));this.markers.append(node);this.nodes.set(row.id,node);}
   node.style.transform=`translate(${row.x-22}px,${row.y-22}px)`;
   const info=statuses.get(row.id),safe=info?.allowed,blocked=info&&!safe,uncertain=blocked&&info.reasons.every(r=>r==='solar_indeterminate'),goal=row.id===targetId,current=row.id===state.airportId,selected=row.id===selectedId;
   node.dataset.airportId=row.id;node.dataset.status=current?'current':safe?'safe':blocked?'blocked':'unknown';node.className=`map-marker airport ${row.cluster?'cluster':''} ${row.cluster&&row.group.some(r=>statuses.get(r.id)?.allowed)?'has-safe':''} ${detail?'detail':'overview'} ${safe?'safe':blocked?'blocked':''} ${goal?'goal':''} ${selected?'selected':''} ${current?'current':''}`;
   const groupSafe=row.cluster&&row.group.some(r=>statuses.get(r.id)?.allowed);
   const glyph=goal?'⚑':current?'◆':row.cluster?(groupSafe?'✓':detail?String(row.count):'+'):safe?'✓':uncertain&&detail?'?':blocked&&detail?'×':'·';
   node.replaceChildren(Object.assign(document.createElement('span'),{className:'marker-dot',textContent:glyph}),Object.assign(document.createElement('span'),{className:'marker-label',textContent:row.label?.text??''}));
   const labelNode=node.querySelector('.marker-label');labelNode.hidden=!row.label;if(row.label){labelNode.style.left=(row.label.left-row.x+22)+'px';labelNode.style.top=(row.label.top-row.y+22)+'px';labelNode.style.width=(row.label.right-row.label.left)+'px';}
   node.title=row.cluster?`${row.count} аэродромов — приблизьте или выберите из группы`:row.airport.name;
   node.setAttribute('aria-label',row.cluster?`${row.count} аэродромов${goal?', включая цель':''}${current?', вы здесь':''}${groupSafe?', есть доступные':''}: ${this.camera.zoom>=4.8?'выбрать из группы':'приблизить'}`:`${row.airport.label??row.airport.name??row.id}${goal?', цель':''}${current?', вы здесь':safe?', полёт доступен':blocked?', полёт недоступен':', выбрать для проверки'}`);
  }
  for(const [id,node] of this.nodes)if(!live.has(id)){node.remove();this.nodes.delete(id);}
 }
 destroy(){this.resizeObserver.disconnect();}
}
