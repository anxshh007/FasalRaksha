/** Geodesy. One implementation of distance for the whole codebase. */
import { ROAD_DISTANCE_FACTOR } from '../constants/policy.js';
import type { GeoPoint } from './types.js';

/** IUGG mean Earth radius, km. */
export const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Estimated road distance: the great-circle distance times a circuity factor. Freight is priced
 * on road kilometres; a straight line under-prices every trip.
 */
export function roadKm(a: GeoPoint, b: GeoPoint): number {
  return distanceKm(a, b) * ROAD_DISTANCE_FACTOR.value;
}

/** The mean of a set of points — adequate at district scale, where curvature is negligible. */
export function centroid(points: readonly GeoPoint[]): GeoPoint {
  if (points.length === 0) throw new RangeError('The centroid of no points is undefined.');
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), { lat: 0, lon: 0 });
  return { lat: sum.lat / points.length, lon: sum.lon / points.length };
}
