import { UserVector } from './featureVector';

// Placeholders pending real click-through data, per the design doc.
const W_DENSE = 0.7;
const W_OVERLAP = 0.3;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const id of setA) {
    if (setB.has(id)) {
      intersection += 1;
    }
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Cold-start collapse: if either user has no behavioral vector, the
// comparison drops to plain explicit-only cosine -- no weight
// renormalization needed since only one term exists in that case.
export function similarityScore(a: UserVector, b: UserVector): number {
  if (a.behavioral === null || b.behavioral === null) {
    return cosineSimilarity(a.explicit, b.explicit);
  }
  const denseA = [...a.explicit, ...a.behavioral];
  const denseB = [...b.explicit, ...b.behavioral];
  const dense = cosineSimilarity(denseA, denseB);
  const overlap = jaccardSimilarity(a.topRankedPlaceIds, b.topRankedPlaceIds);
  return W_DENSE * dense + W_OVERLAP * overlap;
}
