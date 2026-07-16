import { prisma } from '../../prisma';
import { computeUserBehavioralData } from './behavioralFeatures';
import { behavioralFeatureNames } from './featureRegistry';
import { buildUserVector, computePopulationStats, UserVector } from './featureVector';
import { similarityScore } from './similarityScore';

// Nightly batch (or on-demand for a user with no cache entry yet). Pool
// restriction is the load-bearing rule: only profile_public=true users are
// ever candidates, and a private user's data never touches the computation
// (not merely filtered from the output).
export async function runSimilarityBatch(): Promise<void> {
  const publicUsers = await prisma.user.findMany({ where: { profilePublic: true } });

  const behavioralByUser = new Map<string, Awaited<ReturnType<typeof computeUserBehavioralData>>>();
  for (const user of publicUsers) {
    behavioralByUser.set(user.id, await computeUserBehavioralData(user.id));
  }

  const behavioralRows = [...behavioralByUser.values()]
    .map((data) => data.raw)
    .filter((raw): raw is Record<string, number> => raw !== null);
  const populationStats = computePopulationStats(behavioralRows, behavioralFeatureNames());

  const vectors = new Map<string, UserVector>();
  for (const user of publicUsers) {
    const behavioral = behavioralByUser.get(user.id)!;
    vectors.set(
      user.id,
      buildUserVector(
        {
          pref_budget_level: user.prefBudgetLevel,
          pref_pace: user.prefPace,
          pref_environment_type: user.prefEnvironmentType,
        },
        behavioral.raw,
        populationStats,
        behavioral.topRankedPlaceIds,
      ),
    );
  }

  const userIds = [...vectors.keys()];
  const rows: Array<{ userId: string; similarUserId: string; score: number }> = [];
  for (const userId of userIds) {
    for (const otherId of userIds) {
      if (userId === otherId) {
        continue;
      }
      rows.push({ userId, similarUserId: otherId, score: similarityScore(vectors.get(userId)!, vectors.get(otherId)!) });
    }
  }

  await prisma.userSimilarityCache.deleteMany({});
  if (rows.length > 0) {
    await prisma.userSimilarityCache.createMany({ data: rows });
  }
}
