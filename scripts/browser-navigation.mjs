// SPDX-License-Identifier: GPL-3.0-only
/** A fresh scenario by default; persistence tests explicitly keep the saved party. */
export async function openFlightPage({send, evaluate, until, rootUrl, preserveSave = false, campaign = false}) {
 await evaluate(`(async()=>{
  if (${!preserveSave} && location.origin===${JSON.stringify(new URL(rootUrl).origin)}) {
   if (location.pathname.endsWith('/web/flight/index.html') && document.body?.dataset.ready==='true') {
    const {app}=await import('./app.mjs');
    app.destroy();
   }
   localStorage.clear();
  }
  window.leavingFlightPage=true;
 })()`);
 await send('Page.navigate', {url:rootUrl+'web/flight/index.html'+(campaign?'':'?scenario=airport-spike')});
 await until(`!window.leavingFlightPage && document.body?.dataset.ready==='true' && location.pathname.endsWith('/web/flight/index.html')`);
}
