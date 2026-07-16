-- CreateTable
CREATE TABLE "UserSimilarityCache" (
    "userId" TEXT NOT NULL,
    "similarUserId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSimilarityCache_pkey" PRIMARY KEY ("userId","similarUserId")
);

-- CreateTable
CREATE TABLE "TripSuggestionDismissal" (
    "userId" TEXT NOT NULL,
    "clusterSignature" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripSuggestionDismissal_pkey" PRIMARY KEY ("userId","clusterSignature")
);
