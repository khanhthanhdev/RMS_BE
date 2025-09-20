-- CreateTable
CREATE TABLE "MatchScoreDetail" (
    "matchId" TEXT NOT NULL,
    "scoreDetails" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchScoreDetail_pkey" PRIMARY KEY ("matchId")
);

-- CreateIndex
CREATE INDEX "MatchScoreDetail_updatedAt_idx" ON "MatchScoreDetail"("updatedAt");

-- AddForeignKey
ALTER TABLE "MatchScoreDetail" ADD CONSTRAINT "MatchScoreDetail_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
