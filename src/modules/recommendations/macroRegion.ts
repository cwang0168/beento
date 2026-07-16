// Coarse, fixed ~15-region world bucketing (not per-city) so `region_share`
// stays a dense ~15-dim feature rather than an unbounded sparse one, per
// the Phase 3 design doc §2. Approximate bounding boxes -- good enough for
// a behavioral taste signal, not a geocoding service.

export type MacroRegion =
  | 'north_america'
  | 'central_america_caribbean'
  | 'south_america'
  | 'western_europe'
  | 'eastern_europe'
  | 'north_africa'
  | 'sub_saharan_africa'
  | 'middle_east'
  | 'south_asia'
  | 'east_asia'
  | 'southeast_asia'
  | 'oceania'
  | 'central_asia_russia'
  | 'other';

export const MACRO_REGIONS: MacroRegion[] = [
  'north_america',
  'central_america_caribbean',
  'south_america',
  'western_europe',
  'eastern_europe',
  'north_africa',
  'sub_saharan_africa',
  'middle_east',
  'south_asia',
  'east_asia',
  'southeast_asia',
  'oceania',
  'central_asia_russia',
  'other',
];

interface BoundingBox {
  region: MacroRegion;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// Ordered; first match wins. Deliberately coarse and slightly overlapping
// in ambiguous zones -- resolved by list order.
const BOXES: BoundingBox[] = [
  { region: 'north_america', minLat: 15, maxLat: 72, minLng: -170, maxLng: -50 },
  { region: 'central_america_caribbean', minLat: 7, maxLat: 15, minLng: -95, maxLng: -60 },
  { region: 'south_america', minLat: -56, maxLat: 13, minLng: -82, maxLng: -34 },
  { region: 'western_europe', minLat: 36, maxLat: 71, minLng: -10, maxLng: 15 },
  { region: 'eastern_europe', minLat: 36, maxLat: 71, minLng: 15, maxLng: 40 },
  { region: 'north_africa', minLat: 15, maxLat: 37, minLng: -17, maxLng: 35 },
  { region: 'sub_saharan_africa', minLat: -35, maxLat: 15, minLng: -18, maxLng: 52 },
  { region: 'middle_east', minLat: 12, maxLat: 42, minLng: 35, maxLng: 63 },
  { region: 'south_asia', minLat: 5, maxLat: 38, minLng: 63, maxLng: 92 },
  { region: 'east_asia', minLat: 18, maxLat: 54, minLng: 100, maxLng: 150 },
  { region: 'southeast_asia', minLat: -11, maxLat: 23, minLng: 92, maxLng: 141 },
  { region: 'oceania', minLat: -50, maxLat: -10, minLng: 110, maxLng: 180 },
  { region: 'central_asia_russia', minLat: 38, maxLat: 78, minLng: 40, maxLng: 180 },
];

export function macroRegionFor(lat: number, lng: number): MacroRegion {
  for (const box of BOXES) {
    if (lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng) {
      return box.region;
    }
  }
  return 'other';
}
