import { MACRO_REGIONS } from './macroRegion';

const PLACE_CATEGORIES = ['restaurant', 'hotel', 'bar', 'activity'] as const;

export interface FeatureDefinition {
  name: string;
  source: 'explicit' | 'behavioral';
  type: 'categorical' | 'continuous';
  encoding: 'one_hot' | 'zscore';
  values?: string[]; // required for categorical
  weight: number;
}

// Single source of truth for both the vector-builder and the batch job.
// Looping over this list -- rather than hardcoding field access -- is what
// makes "add a dimension = config change" actually true (Phase 3 design §4).
export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  // Explicit dims (User preference profile, FR-2)
  { name: 'pref_budget_level', source: 'explicit', type: 'categorical', encoding: 'one_hot', values: ['low', 'medium', 'high'], weight: 1 },
  { name: 'pref_pace', source: 'explicit', type: 'categorical', encoding: 'one_hot', values: ['relaxed', 'moderate', 'packed'], weight: 1 },
  {
    name: 'pref_environment_type',
    source: 'explicit',
    type: 'categorical',
    encoding: 'one_hot',
    values: ['urban', 'nature', 'beach', 'mixed'],
    weight: 1,
  },

  // Behavioral dims, generated from fixed/bounded taxonomies (categories, macro-regions)
  ...PLACE_CATEGORIES.map(
    (category): FeatureDefinition => ({
      name: `category_share:${category}`,
      source: 'behavioral',
      type: 'continuous',
      encoding: 'zscore',
      weight: 1,
    }),
  ),
  ...PLACE_CATEGORIES.map(
    (category): FeatureDefinition => ({
      name: `category_avg_rank_percentile:${category}`,
      source: 'behavioral',
      type: 'continuous',
      encoding: 'zscore',
      weight: 1,
    }),
  ),
  ...MACRO_REGIONS.map(
    (region): FeatureDefinition => ({
      name: `region_share:${region}`,
      source: 'behavioral',
      type: 'continuous',
      encoding: 'zscore',
      weight: 1,
    }),
  ),
];

export function behavioralFeatureNames(): string[] {
  return FEATURE_DEFINITIONS.filter((f) => f.source === 'behavioral').map((f) => f.name);
}
