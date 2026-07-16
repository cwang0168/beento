export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

interface ClusterablePoint {
  lat: number;
  lng: number;
}

export type ClusteredEntry<T> =
  | { type: 'place'; place: T }
  | { type: 'cluster'; lat: number; lng: number; count: number };

// Aggregates points into a fixed grid over the bbox (FR-26). A client
// zooming in naturally sends a smaller bbox on the next request, which
// thins out each cell and resolves clusters into individual places --
// no separate "resolve cluster" endpoint needed.
export function clusterPlaces<T extends ClusterablePoint>(
  places: T[],
  bbox: BoundingBox,
  options: { gridSize?: number; threshold?: number } = {},
): Array<ClusteredEntry<T>> {
  const gridSize = options.gridSize ?? 8;
  const threshold = options.threshold ?? 5;

  const latStep = bbox.maxLat > bbox.minLat ? (bbox.maxLat - bbox.minLat) / gridSize : 0;
  const lngStep = bbox.maxLng > bbox.minLng ? (bbox.maxLng - bbox.minLng) / gridSize : 0;

  const cellOf = (value: number, min: number, step: number): number =>
    step === 0 ? 0 : Math.min(gridSize - 1, Math.max(0, Math.floor((value - min) / step)));

  const cells = new Map<string, T[]>();
  for (const place of places) {
    const row = cellOf(place.lat, bbox.minLat, latStep);
    const col = cellOf(place.lng, bbox.minLng, lngStep);
    const key = `${row}:${col}`;
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(place);
    } else {
      cells.set(key, [place]);
    }
  }

  const result: Array<ClusteredEntry<T>> = [];
  for (const bucket of cells.values()) {
    if (bucket.length > threshold) {
      const lat = bucket.reduce((sum, p) => sum + p.lat, 0) / bucket.length;
      const lng = bucket.reduce((sum, p) => sum + p.lng, 0) / bucket.length;
      result.push({ type: 'cluster', lat, lng, count: bucket.length });
    } else {
      for (const place of bucket) {
        result.push({ type: 'place', place });
      }
    }
  }
  return result;
}
