// SPDX-License-Identifier: GPL-3.0-only
export interface AircraftProfile {
  profileVersion: number; id: string; name: string;
  facts: {usableTankLitres: number; maxTakeoffKg: number; maxLandingKg: number; maxZeroFuelKg: number;
    cruiseTasKnots: number; cruiseMach: number; publishedRangeNm: number; referenceTakeoffDistanceM: number; referenceLandingDistanceM: number};
  assumptions: {fuelDensityKgPerLitre: number; zeroFuelKg: number; cruiseBurnKgPerKm: number;
    departureSeconds: number; arrivalSeconds: number; departureBurnKg: number; arrivalBurnKg: number;
    serviceSeconds: number; refuellingSetupSeconds: number; refuellingLitresPerMinute: number;
    serviceBurnKgPerSecond: number; planningReserveKg: number; windKmPerHour: number;
    runwayScreenLengthM: number; runwayScreenWidthM: number};
}
const finite=(value: number,name: string,min=0): void=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min)throw new RangeError('Invalid '+name);};
export function validateAircraftProfile(value: unknown): asserts value is AircraftProfile {
 const p=value as AircraftProfile;
 if(!p||p.profileVersion!==1||typeof p.id!=='string'||!p.id||!p.facts||!p.assumptions)throw new RangeError('Invalid aircraft profile');
 for(const [key,n] of Object.entries(p.facts))finite(n,key,Number.MIN_VALUE);
 const f=p.facts,a=p.assumptions;
 for(const key of ['usableTankLitres','maxTakeoffKg','maxLandingKg','maxZeroFuelKg','cruiseTasKnots','cruiseMach','publishedRangeNm','referenceTakeoffDistanceM','referenceLandingDistanceM'] as const)finite(f[key],key,Number.MIN_VALUE);
 for(const key of ['fuelDensityKgPerLitre','zeroFuelKg','cruiseBurnKgPerKm','departureSeconds','arrivalSeconds','departureBurnKg','arrivalBurnKg','serviceSeconds','refuellingSetupSeconds','refuellingLitresPerMinute','serviceBurnKgPerSecond','planningReserveKg','windKmPerHour','runwayScreenLengthM','runwayScreenWidthM'] as const)finite(a[key],key);
 if(a.cruiseBurnKgPerKm<=0||a.refuellingLitresPerMinute<=0||a.fuelDensityKgPerLitre<=0||a.windKmPerHour!==0)throw new RangeError('Unsupported aircraft assumptions');
 const capacity=f.usableTankLitres*a.fuelDensityKgPerLitre;
 if(a.zeroFuelKg>f.maxZeroFuelKg||a.zeroFuelKg+capacity>f.maxTakeoffKg||a.zeroFuelKg>f.maxLandingKg||a.planningReserveKg>=capacity)throw new RangeError('Aircraft mass/capacity contradiction');
}
export function aircraftMetrics(p: AircraftProfile): {fuelCapacityKg: number; cruiseKmPerHour: number; refuellingKgPerSecond: number; fullFuelRangeKm: number; fullTankMinimumLandingDistanceKm: number} {
 validateAircraftProfile(p);const f=p.facts,a=p.assumptions,capacity=f.usableTankLitres*a.fuelDensityKgPerLitre;
 const fixed=a.departureBurnKg+a.arrivalBurnKg+a.serviceSeconds*a.serviceBurnKgPerSecond;
 return {fuelCapacityKg:capacity,cruiseKmPerHour:f.cruiseTasKnots*1.852,refuellingKgPerSecond:a.refuellingLitresPerMinute*a.fuelDensityKgPerLitre/60,
   fullFuelRangeKm:Math.max(0,(capacity-fixed-a.planningReserveKg)/a.cruiseBurnKgPerKm),
   fullTankMinimumLandingDistanceKm:Math.max(0,(a.zeroFuelKg+capacity-a.departureBurnKg-a.arrivalBurnKg-f.maxLandingKg)/a.cruiseBurnKgPerKm)};
}
/** Resource/mass reference only. Solar safety is deliberately left to the existing route kernel. */
export function aircraftLeg(p: AircraftProfile,distanceKm: number,initialFuelKg: number): {durationSeconds: number; burnKg: number; arrivalFuelKg: number; takeoffMassKg: number; landingMassKg: number; dispatchable: boolean; reasons: string[]} {
 const m=aircraftMetrics(p);finite(distanceKm,'distance',Number.MIN_VALUE);finite(initialFuelKg,'fuel');
 if(initialFuelKg>m.fuelCapacityKg)throw new RangeError('Fuel exceeds tank capacity');
 const a=p.assumptions,burn=a.departureBurnKg+distanceKm*a.cruiseBurnKgPerKm+a.arrivalBurnKg;
 const takeoffMass=a.zeroFuelKg+initialFuelKg,landingMass=takeoffMass-burn,reasons: string[]=[];
 if(initialFuelKg<burn+a.planningReserveKg)reasons.push('fuel_or_reference_reserve');
 if(takeoffMass>p.facts.maxTakeoffKg)reasons.push('takeoff_mass');
 if(landingMass>p.facts.maxLandingKg)reasons.push('landing_mass');
 return {durationSeconds:a.departureSeconds+distanceKm/m.cruiseKmPerHour*3600+a.arrivalSeconds,burnKg:burn,arrivalFuelKg:initialFuelKg-burn,
   takeoffMassKg:takeoffMass,landingMassKg:landingMass,dispatchable:reasons.length===0,reasons};
}
export function aircraftRefuelling(p: AircraftProfile,fuelKg: number,stockKg: number): {transferKg: number; fuelKg: number; stockKg: number; durationSeconds: number} {
 const m=aircraftMetrics(p);finite(fuelKg,'fuel');finite(stockKg,'stock');if(fuelKg>m.fuelCapacityKg)throw new RangeError('Fuel exceeds tank capacity');
 const transferKg=Math.min(m.fuelCapacityKg-fuelKg,stockKg);
 return {transferKg,fuelKg:fuelKg+transferKg,stockKg:stockKg-transferKg,durationSeconds:transferKg===0?0:p.assumptions.refuellingSetupSeconds+transferKg/m.refuellingKgPerSecond};
}
