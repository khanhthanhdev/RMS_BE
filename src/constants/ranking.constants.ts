/**
 * FRC Standard Ranking Constants
 * Defines the standard ranking hierarchy used throughout the tournament system
 */

// FRC Standard Ranking Order (descending priority)
export const FRC_RANKING_ORDER = [
  { rankingPoints: 'desc' as const },
  { tiebreaker1: 'desc' as const }, // Opponent Win Percentage
  { pointDifferential: 'desc' as const },
  { tiebreaker2: 'desc' as const }  // Points Scored (final tiebreaker)
];

// Alternative ranking orders for specific use cases
export const QUALIFICATION_RANKING_ORDER = FRC_RANKING_ORDER; // Same as FRC standard

export const PLAYOFF_SEEDING_ORDER = [
  { rankingPoints: 'desc' as const },
  { tiebreaker1: 'desc' as const }, // OWP
  { pointDifferential: 'desc' as const },
  { tiebreaker2: 'desc' as const }  // Points scored
] as const;

// Legacy orders (for reference only - should not be used)
export const LEGACY_SWISS_ORDER = [
  { rankingPoints: 'desc' as const },
  { opponentWinPercentage: 'desc' as const },
  { pointDifferential: 'desc' as const },
  { matchesPlayed: 'desc' as const }
] as const;

export const LEGACY_TEAM_STATS_API_ORDER = [
  { rankingPoints: 'desc' as const },
  { opponentWinPercentage: 'desc' as const },
  { pointDifferential: 'desc' as const },
  { pointsScored: 'desc' as const }
] as const;

/**
 * Tiebreaker Field Definitions (after migration)
 */
export const TIEBREAKER_DEFINITIONS = {
  tiebreaker1: 'Opponent Win Percentage (OWP)',
  tiebreaker2: 'Points Scored (final tiebreaker)'
} as const;

/**
 * FRC Ranking Points Calculation
 */
export const FRC_RANKING_POINTS = {
  WIN: 2,
  TIE: 1,
  LOSS: 0
} as const;
