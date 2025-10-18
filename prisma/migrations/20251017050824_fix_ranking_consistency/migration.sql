-- Migration: Fix ranking consistency issues
-- This migration addresses inconsistent usage of tiebreaker fields in TeamStats

-- Step 1: Add temporary columns to preserve current data
ALTER TABLE "TeamStats" ADD COLUMN "old_tiebreaker1" Float;
ALTER TABLE "TeamStats" ADD COLUMN "old_tiebreaker2" Float;

-- Step 2: Backup current tiebreaker values
UPDATE "TeamStats" SET
  "old_tiebreaker1" = "tiebreaker1",
  "old_tiebreaker2" = "tiebreaker2";

-- Step 3: Update tiebreaker fields to follow FRC standard ranking:
-- tiebreaker1 = opponentWinPercentage (already correct)
-- tiebreaker2 = pointsScored (for final tiebreaker)
UPDATE "TeamStats" SET
  "tiebreaker1" = "opponentWinPercentage",
  "tiebreaker2" = "pointsScored";

-- Step 4: Add comments to document the new standard
COMMENT ON COLUMN "TeamStats"."tiebreaker1" IS 'Opponent Win Percentage - FRC ranking tiebreaker #1';
COMMENT ON COLUMN "TeamStats"."tiebreaker2" IS 'Points Scored - FRC ranking tiebreaker #4 (final)';

-- Step 5: Verify data integrity (this will be rolled back if any constraint fails)
-- Ensure OWP is between 0 and 1
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TeamStats" WHERE "tiebreaker1" < 0 OR "tiebreaker1" > 1) THEN
    RAISE EXCEPTION 'Invalid OWP values found in tiebreaker1';
  END IF;
END $$;

-- Step 6: Clean up temporary columns
ALTER TABLE "TeamStats" DROP COLUMN "old_tiebreaker1";
ALTER TABLE "TeamStats" DROP COLUMN "old_tiebreaker2";
