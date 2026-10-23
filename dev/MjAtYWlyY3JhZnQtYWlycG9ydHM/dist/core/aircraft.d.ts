export interface AircraftProfile {
    profileVersion: number;
    id: string;
    name: string;
    facts: {
        usableTankLitres: number;
        maxTakeoffKg: number;
        maxLandingKg: number;
        maxZeroFuelKg: number;
        cruiseTasKnots: number;
        cruiseMach: number;
        publishedRangeNm: number;
        referenceTakeoffDistanceM: number;
        referenceLandingDistanceM: number;
    };
    assumptions: {
        fuelDensityKgPerLitre: number;
        zeroFuelKg: number;
        cruiseBurnKgPerKm: number;
        departureSeconds: number;
        arrivalSeconds: number;
        departureBurnKg: number;
        arrivalBurnKg: number;
        serviceSeconds: number;
        refuellingSetupSeconds: number;
        refuellingLitresPerMinute: number;
        serviceBurnKgPerSecond: number;
        planningReserveKg: number;
        windKmPerHour: number;
        runwayScreenLengthM: number;
        runwayScreenWidthM: number;
    };
}
export declare function validateAircraftProfile(value: unknown): asserts value is AircraftProfile;
export declare function aircraftMetrics(p: AircraftProfile): {
    fuelCapacityKg: number;
    cruiseKmPerHour: number;
    refuellingKgPerSecond: number;
    fullFuelRangeKm: number;
    fullTankMinimumLandingDistanceKm: number;
};
/** Resource/mass reference only. Solar safety is deliberately left to the existing route kernel. */
export declare function aircraftLeg(p: AircraftProfile, distanceKm: number, initialFuelKg: number): {
    durationSeconds: number;
    burnKg: number;
    arrivalFuelKg: number;
    takeoffMassKg: number;
    landingMassKg: number;
    dispatchable: boolean;
    reasons: string[];
};
export declare function aircraftRefuelling(p: AircraftProfile, fuelKg: number, stockKg: number): {
    transferKg: number;
    fuelKg: number;
    stockKg: number;
    durationSeconds: number;
};
