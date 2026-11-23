// SPDX-License-Identifier: GPL-3.0-only
import { aircraftMetrics } from './aircraft.js';
export function validateFleet(world, fleet) {
    if (typeof fleet.initialAircraftId !== 'string' || !fleet.initialAircraftId ||
        !Number.isFinite(fleet.transferSeconds) || fleet.transferSeconds <= 0 ||
        !Array.isArray(fleet.regionalProfiles) || !Array.isArray(fleet.parked))
        throw new RangeError('Invalid fleet definition');
    const ids = new Set([fleet.initialAircraftId]), profiles = new Set([world.profile.id]);
    const airports = new Set(world.airports.map(a => a.id));
    for (const { profile, airportIds } of fleet.regionalProfiles) {
        aircraftMetrics(profile);
        if (profiles.has(profile.id) || !Array.isArray(airportIds) || !airportIds.length ||
            new Set(airportIds).size !== airportIds.length || airportIds.some(id => !airports.has(id)))
            throw new RangeError('Invalid regional aircraft profile');
        profiles.add(profile.id);
    }
    for (const plane of fleet.parked) {
        if (typeof plane.id !== 'string' || !plane.id || ids.has(plane.id) || !profiles.has(plane.profileId))
            throw new RangeError('Invalid parked aircraft ID or profile');
        const dispatch = aircraftWorld(world, fleet, plane.profileId);
        if (!world.airports.some(a => a.id === plane.airportId && airportSuitable(dispatch, a)) ||
            !Number.isFinite(plane.fuelKg) || plane.fuelKg < 0 || plane.fuelKg > aircraftMetrics(dispatch.profile).fuelCapacityKg)
            throw new RangeError('Invalid parked aircraft airport or fuel');
        ids.add(plane.id);
    }
}
export function aircraftWorld(world, fleet, profileId) {
    if (profileId === world.profile.id)
        return world;
    const regional = fleet.regionalProfiles.find(item => item.profile.id === profileId);
    if (!regional)
        throw new RangeError('Unknown aircraft profile');
    return { ...world, profile: regional.profile, screenedAirportIds: regional.airportIds };
}
export function airportSuitable(world, airport) {
    return world.screenedAirportIds?.includes(airport.id) ?? (airport.suitability.status === 'screened-candidate');
}
