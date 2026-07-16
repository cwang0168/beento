import crypto from 'crypto';
import { haversineDistanceKm } from '../places/places.service';

export interface ClusterableLog {
  placeId: string;
  lat: number;
  lng: number;
  loggedAt: Date;
}

export interface TripCluster {
  placeIds: string[];
  startDate: Date;
  endDate: Date;
}

// Placeholders pending usage data, per the design doc.
const MAX_GAP_MS = 72 * 60 * 60 * 1000;
const MAX_DISTANCE_KM = 50;
const MIN_CLUSTER_SIZE = 2;

// Consecutive-by-time Logs within 72h AND 50km of the previous Log in the
// cluster are grouped together. A single logged place is not a trip.
export function clusterLogsForTripSuggestions(logs: ClusterableLog[]): TripCluster[] {
  const sorted = [...logs].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime());

  const clusters: ClusterableLog[][] = [];
  let current: ClusterableLog[] = [];

  for (const log of sorted) {
    if (current.length === 0) {
      current.push(log);
      continue;
    }
    const prev = current[current.length - 1];
    const gapMs = log.loggedAt.getTime() - prev.loggedAt.getTime();
    const distanceKm = haversineDistanceKm(prev, log);
    if (gapMs <= MAX_GAP_MS && distanceKm <= MAX_DISTANCE_KM) {
      current.push(log);
    } else {
      clusters.push(current);
      current = [log];
    }
  }
  if (current.length > 0) {
    clusters.push(current);
  }

  return clusters
    .filter((cluster) => cluster.length >= MIN_CLUSTER_SIZE)
    .map((cluster) => ({
      placeIds: cluster.map((log) => log.placeId),
      startDate: cluster[0].loggedAt,
      endDate: cluster[cluster.length - 1].loggedAt,
    }));
}

// Hash of sorted place_ids -- stable across re-computation, changes if the
// cluster's membership changes (a materially different suggestion).
export function clusterSignature(placeIds: string[]): string {
  return crypto.createHash('sha256').update([...placeIds].sort().join(',')).digest('hex');
}
