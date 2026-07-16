import { macroRegionFor, MACRO_REGIONS } from './macroRegion';

describe('macroRegionFor', () => {
  it('classifies Lisbon as western_europe', () => {
    expect(macroRegionFor(38.7223, -9.1393)).toBe('western_europe');
  });

  it('classifies New York as north_america', () => {
    expect(macroRegionFor(40.7128, -74.006)).toBe('north_america');
  });

  it('classifies Tokyo as east_asia', () => {
    expect(macroRegionFor(35.6762, 139.6503)).toBe('east_asia');
  });

  it('classifies Sydney as oceania', () => {
    expect(macroRegionFor(-33.8688, 151.2093)).toBe('oceania');
  });

  it('falls back to other for an unclassified point (deep ocean / poles)', () => {
    expect(macroRegionFor(0, -160)).toBe('other');
  });

  it('every returned region is a member of MACRO_REGIONS', () => {
    const samples: Array<[number, number]> = [
      [38.7223, -9.1393],
      [40.7128, -74.006],
      [35.6762, 139.6503],
      [-33.8688, 151.2093],
      [0, -160],
      [28.6139, 77.209], // Delhi
      [-1.2921, 36.8219], // Nairobi
      [55.7558, 37.6173], // Moscow
    ];
    for (const [lat, lng] of samples) {
      expect(MACRO_REGIONS).toContain(macroRegionFor(lat, lng));
    }
  });
});
