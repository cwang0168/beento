import { haversineDistanceKm } from './places.service';

describe('haversineDistanceKm', () => {
  it('returns ~0 for the same point', () => {
    const point = { lat: 38.7223, lng: -9.1393 };
    expect(haversineDistanceKm(point, point)).toBeCloseTo(0, 5);
  });

  it('returns the known distance between Lisbon and Porto (~275km)', () => {
    const lisbon = { lat: 38.7223, lng: -9.1393 };
    const porto = { lat: 41.1579, lng: -8.6291 };
    expect(haversineDistanceKm(lisbon, porto)).toBeGreaterThan(270);
    expect(haversineDistanceKm(lisbon, porto)).toBeLessThan(280);
  });
});
