import { z } from 'zod';

export const categoryEnum = z.enum(['restaurant', 'hotel', 'bar', 'activity']);
export type PlaceCategoryValue = z.infer<typeof categoryEnum>;
