// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCampaignData} from '../scripts/campaign-data.mjs';
import {replaySouthernWitness,westwardRouteEvidence,longitudeStep} from '../scripts/westward-research.mjs';
const data=await loadCampaignData();
test('western route evidence crosses the dateline; direct eastern endpoints do not establish a circuit',()=>{
 const direct=westwardRouteEvidence(data.airports,['SCEL','FACT']);assert.equal(direct.westwardAroundWorld,false);assert.ok(direct.longitudeChangeDeg>0);
 const circuit=westwardRouteEvidence(data.airports,['SCEL','NZCH','YPPH','FACT']);assert.equal(circuit.westwardAroundWorld,true);assert.ok(circuit.longitudeChangeDeg<-270);
 assert.equal(longitudeStep({latitudeDeg:0,longitudeDeg:0},{latitudeDeg:0,longitudeDeg:180}),null);
});
test('southern multi-refuelling witness is fully safe while direct eastern cruise is sunlit, with finite maximum loading',()=>{
 const original=structuredClone(data.fuel),r=replaySouthernWitness(data);assert.deepEqual(data.fuel,original);
 assert.equal(r.direct.solar.status,'unsafe');assert.equal(r.direct.solar.phase,'cruise');assert.equal(r.final.won,true);assert.equal(r.final.flights,3);
 assert.ok(r.final.distanceKm>23000);assert.ok(r.polarDays.every(d=>d.certificate.status==='safe'));assert.ok(r.coarse.every(l=>l.status==='safe'&&l.sameEnd));
 let fuel=r.settings.initialFuelKg;
 for(const leg of r.legs){assert.equal(leg.initialFuelKg,fuel);assert.equal(leg.solar.status,'safe');assert.equal(leg.refuelling.transferKg,32000);assert.equal(leg.refuelling.stockKg,0);fuel=fuel-leg.flight.burnKg+leg.refuelling.transferKg;}
 assert.ok(Math.abs(fuel-r.final.fuelKg)<1e-8);
 assert.deepEqual(Object.keys(r.final.stockChangesKg).sort(),['FACT','NZCH','YPPH']);
 for(const first of ['YSSY','YMML']) {
  const alternative=replaySouthernWitness(data,[first,'YPPH','FACT']);assert.equal(alternative.final.won,true);assert.equal(alternative.evidence.westwardAroundWorld,true);
  assert.ok(alternative.legs.every(l=>l.solar.status==='safe'));
 }
});
