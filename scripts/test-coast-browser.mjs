// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {openFlightPage} from './browser-navigation.mjs';

const regions=[
 ['europe',55,10],['islands',12,123],['dateline',0,180],['north',90,0],['south',-90,0],
];

export async function coastScenarioRun({send,evaluate,until,rootUrl}) {
 const baseline=process.env.COAST_BASELINE==='1';
 const benchmark=process.env.COAST_BENCHMARK==='1';
 const timings=[],gestures=[];
 await openFlightPage({send,evaluate,until,rootUrl});
 await evaluate(`import('./app.mjs').then(m=>{window.coastApp=m.app;return true;})`);
 await until('coastApp.planner.summary().complete');
 const saved=await evaluate('coastApp.controller.session.save()');
 await mkdir('.build/previews',{recursive:true});

 for (const width of [1280,390,320]) {
  for (const dpr of [1,2]) {
   await send('Emulation.setDeviceMetricsOverride',{width,height:width===1280?900:844,deviceScaleFactor:dpr,mobile:width<760});
   await send('Emulation.setTouchEmulationEnabled',{enabled:width<760});
   for (const [region,latitudeDeg,longitudeDeg] of regions) {
    for (const zoom of [1,3,5]) {
     const result=await evaluate(`(()=>{
      const a=coastApp,g=a.globe,start=performance.now();
      g.focus({latitudeDeg:${latitudeDeg},longitudeDeg:${longitudeDeg}},${zoom});a.render();
      const prepareMs=performance.now()-start,path=g.landPath,geometry=g.geometry,times=[];
      for(let i=0;i<${benchmark?3:1};i++){
       const begin=performance.now();g.draw(a.controller.view.state.utcMs);times.push(performance.now()-begin);
      }
      return {prepareMs,times,cached:path===g.landPath&&geometry===g.geometry,canvasWidth:g.canvas.width};
     })()`);
     assert.equal(result.cached,true,'UTC redraw must reuse projected coast geometry');
     assert.equal(result.canvasWidth,width===1280?(1280-340)*dpr:width*dpr);
     timings.push({width,dpr,region,zoom,prepareMs:result.prepareMs,drawMs:result.times});
     if ((width===1280&&dpr===1||width===320&&dpr===2)&&
         (['europe','islands'].includes(region)||zoom===3)) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      const prefix=baseline?'baseline-coast':'coast';
      await writeFile(`.build/previews/${prefix}-${region}-${width}-${dpr}-${zoom}.png`,Buffer.from(shot.data,'base64'));
     }
    }
   }
   const landHits=[];
   for (const [latitudeDeg,longitudeDeg] of [[-25,134],[20,15],[-88,0],[0,-140],[90,0],[-90,0]]) {
    landHits.push(await evaluate(`(()=>{
     const a=coastApp,g=a.globe;
     g.focus({latitudeDeg:${latitudeDeg},longitudeDeg:${longitudeDeg}},3);a.render();
     ${baseline?`return g.landPixels[(Math.floor((90-(${latitudeDeg}))/180*512)%512*1024+Math.floor((${longitudeDeg}+180)/360*1024))*4+3]>90;`:`
     g.ctx.save();g.ctx.resetTransform();
     const inside=g.ctx.isPointInPath(g.landPath,g.frame.cx,g.frame.cy);g.ctx.restore();return inside;`}
    })()`));
   }
   // The old equirectangular mask cannot represent the exact south-pole row.
   assert.deepEqual(landHits.slice(0,baseline?4:6),baseline?[true,true,true,false]:[true,true,true,false,false,true]);

   await evaluate(`(()=>{const g=coastApp.globe;g.canvas.focus();window.coastKeyStart=null;g.canvas.addEventListener('keydown',()=>window.coastKeyStart=performance.now(),{once:true});})()`);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
   await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
   await until('!coastApp.globe.dirty');
   gestures.push({width,dpr,ms:await evaluate('new Promise(r=>requestAnimationFrame(()=>r(performance.now()-coastKeyStart)))')});
  }
 }

 if (!baseline) {
  const edge=await evaluate(`(async()=>{
   const {traceCoastline}=await import('./coastline.mjs');
   const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
   const ctx=canvas.getContext('2d'),path=new Path2D();
   const frame={...coastApp.globe.frame,center:{latitudeDeg:0,longitudeDeg:0},cx:200.37,cy:150,radius:500};
   traceCoastline({type:'Polygon',coordinates:[[[0,-30],[0,30],[30,30],[30,-30],[0,-30]]]},frame,path,2);
   ctx.scale(2,2);ctx.fillStyle='black';ctx.fillRect(0,0,400,300);ctx.fillStyle='white';ctx.fill(path);
   const lake=new Path2D();
   traceCoastline({type:'Polygon',coordinates:[
    [[-30,-30],[-30,30],[30,30],[30,-30],[-30,-30]],
    [[-5,-5],[5,-5],[5,5],[-5,5],[-5,-5]]
   ]},frame,lake,2);
   ctx.save();ctx.resetTransform();
   if(ctx.isPointInPath(lake,frame.cx,frame.cy))throw Error('A polygon hole was filled as land');
   if(!ctx.isPointInPath(lake,frame.cx+frame.radius*Math.sin(15*Math.PI/180),frame.cy))throw Error('Land around a polygon hole disappeared');
   ctx.restore();
   const row=ctx.getImageData(395,300,12,1).data;
   return [...row].filter((_,i)=>i%4===0);
  })()`);
  assert.ok(edge.filter(v=>v>0&&v<255).length<=2,'A vector coast must not smear over a low-resolution texel');
  assert.ok(edge.includes(0)&&edge.includes(255));
 }
 assert.equal(await evaluate('coastApp.controller.session.save()'),saved);
 await writeFile('.build/coast-metrics.json',JSON.stringify({baseline,benchmark,timings,gestures},null,2)+'\n');
 return {passed:true,steps:baseline?['90 baseline camera/zoom/DPR cases','baseline frame and input timings']:['90 camera/zoom/DPR cases','land/ocean and both poles','native-resolution edge and polygon hole','cached UTC redraw','navigation without state mutation'],cases:timings.length};
}
