import { clusterPlaces } from './map.service';

const bbox = { minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 };

describe('clusterPlaces', () => {
  it('returns individual places when a cell is under the threshold', () => {
    const places = [
      { id: '1', lat: 0.1, lng: 0.1 },
      { id: '2', lat: 0.9, lng: 0.9 },
    ];
    const result = clusterPlaces(places, bbox, { gridSize: 2, threshold: 5 });
    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.type === 'place')).toBe(true);
  });

  it('collapses a dense cell into a single cluster above the threshold', () => {
    const places = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, lat: 0.1, lng: 0.1 + i * 0.001 }));
    const result = clusterPlaces(places, bbox, { gridSize: 8, threshold: 5 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'cluster', count: 10 });
  });

  it('computes the cluster centroid as the mean of its members', () => {
    const places = Array.from({ length: 6 }, () => ({ id: 'x', lat: 0.2, lng: 0.4 }));
    const result = clusterPlaces(places, bbox, { gridSize: 8, threshold: 5 });
    expect(result[0].type).toBe('cluster');
    const cluster = result[0] as { type: 'cluster'; lat: number; lng: number; count: number };
    expect(cluster.lat).toBeCloseTo(0.2);
    expect(cluster.lng).toBeCloseTo(0.4);
    expect(cluster.count).toBe(6);
  });

  it('handles a zero-size bbox (single point) without dividing by zero', () => {
    const bboxPoint = { minLat: 10, minLng: 20, maxLat: 10, maxLng: 20 };
    const places = [{ id: '1', lat: 10, lng: 20 }];
    const result = clusterPlaces(places, bboxPoint);
    expect(result).toEqual([{ type: 'place', place: places[0] }]);
  });

  it('keeps distinct cells separate even when both are above the threshold', () => {
    const cellA = Array.from({ length: 6 }, () => ({ id: 'a', lat: 0.1, lng: 0.1 }));
    const cellB = Array.from({ length: 6 }, () => ({ id: 'b', lat: 0.9, lng: 0.9 }));
    const result = clusterPlaces([...cellA, ...cellB], bbox, { gridSize: 2, threshold: 5 });
    expect(result).toHaveLength(2);
    expect(result.every((entry) => entry.type === 'cluster')).toBe(true);
  });
});
