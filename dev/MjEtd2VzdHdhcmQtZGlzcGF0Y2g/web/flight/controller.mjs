// SPDX-License-Identifier: GPL-3.0-only
import {MissionSession} from '../../dist/core/mission.js';
export class FlightController {
 constructor(definition){this.session=new MissionSession(definition);this.selectedId=null;this.playing=false;this.choice=null;this.activeForecast=null;this.tracks=[];this.anchorUtc=this.session.currentTimeUtc;this.anchorReal=0;this.rate=1;this.view=this.session.current();}
 select(id){this.selectedId=id;this.refresh();}
 refresh(){this.view=this.session.current();this.choice=this.selectedId?this.session.forecast(this.selectedId):null;}
 fly(now=performance.now()) {
  if(!this.selectedId)return false;const choice=this.session.fly(this.selectedId);if(!choice.allowed){this.refresh();return false;}
  this.activeForecast=choice.forecast;const cruise=choice.forecast.phases.find(p=>p.label==='cruise');this.tracks.push(cruise.route.path);
  this.rate=(this.session.endUtcMs-this.session.currentTimeUtc)/45000;this.play(now);this.refresh();return true;
 }
 play(now=performance.now()){if(this.session.currentTimeUtc>=this.session.endUtcMs)return;this.anchorUtc=this.session.currentTimeUtc;this.anchorReal=now;this.playing=true;}
 pause(now=performance.now()){if(this.playing)this.tick(now);this.playing=false;}
 tick(now){if(!this.playing)return false;this.advanceTo(Math.max(this.session.currentTimeUtc,this.anchorUtc+Math.max(0,now-this.anchorReal)*this.rate),now,false);return true;}
 advanceTo(utcMs,now=performance.now(),reanchor=true){this.session.stopAt(utcMs);if(reanchor){this.anchorUtc=this.session.currentTimeUtc;this.anchorReal=now;}if(this.session.currentTimeUtc===this.session.endUtcMs){this.playing=false;this.activeForecast=null;}this.refresh();}
}
