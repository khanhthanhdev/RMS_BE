-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bracketSlot" INTEGER,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "feedsIntoMatchId" TEXT,
ADD COLUMN     "loserFeedsIntoMatchId" TEXT,
ADD COLUMN     "recordBucket" TEXT;

-- CreateIndex
CREATE INDEX "Match_stageId_roundNumber_idx" ON "Match"("stageId", "roundNumber");

-- CreateIndex
CREATE INDEX "Match_stageId_bracketSlot_idx" ON "Match"("stageId", "bracketSlot");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_feedsIntoMatchId_fkey" FOREIGN KEY ("feedsIntoMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_loserFeedsIntoMatchId_fkey" FOREIGN KEY ("loserFeedsIntoMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
