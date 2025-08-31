/**
 * Configuration interface for FRC Scheduler based on MatchMaker algorithm
 * Allows customization of all key parameters for tournament scheduling
 */

export interface FrcSchedulerConfig {
  // Match Format Configuration
  teamsPerAlliance: number;           // Default: 3 (FRC standard) or 2 (your current)
  alliancesPerMatch: number;          // Default: 2 (Red vs Blue)
  
  // Quality Settings (MatchMaker standard)
  qualityLevel: 'fair' | 'good' | 'best' | 'custom';
  customIterations?: number;          // Used when qualityLevel is 'custom'
  
  // Simulated Annealing Parameters
  simulatedAnnealing: {
    initialTemperature: number;       // Default: 100.0
    coolingRate: number;              // Default: 0.95
    minTemperature: number;           // Default: 0.01
    iterationsPerTemperature: number; // Default: 100
  };
  
  // Scoring Weights (penalty system)
  penalties: {
    partnerRepeat: number;            // Default: 3.0 (highest penalty)
    opponentRepeat: number;           // Default: 2.0
    generalRepeat: number;            // Default: 1.0
    matchSeparationViolation: number; // Default: 10.0
    redBlueImbalance: number;         // Default: 2.0
    stationImbalance: number;         // Default: 0.5
  };
  
  // Scheduling Constraints
  constraints: {
    minMatchSeparation: number;       // Minimum matches between team appearances
    enableSurrogates: boolean;        // Whether to use surrogate system
    surrogateRound: number;           // Which round to place surrogates (3 is FRC standard)
    enforceRoundUniformity: boolean;  // Ensure each team plays once per round
  };
  
  // Station Balancing Strategy
  stationBalancing: {
    enabled: boolean;
    strategy: 'position' | 'mirrored'; // 'position': R1,R2,R3,B1,B2,B3 | 'mirrored': R1/B3, R2/B2, R3/B1
    perfectBalancing: boolean;        // Use Caleb Sykes perfect balancing algorithm
  };
  
  // Red/Blue Balancing
  allianceBalancing: {
    enabled: boolean;
    priority: 'strict' | 'preferred';  // How aggressively to balance
  };
  
  // Round Configuration
  rounds: {
    count: number;
    uniformDistribution: boolean;     // Ensure even team distribution across rounds
  };
}

/**
 * Default configuration based on MatchMaker algorithm standards
 */
export const DEFAULT_FRC_CONFIG: FrcSchedulerConfig = {
  teamsPerAlliance: 3,
  alliancesPerMatch: 2,
  qualityLevel: 'good',
  
  simulatedAnnealing: {
    initialTemperature: 100.0,
    coolingRate: 0.95,
    minTemperature: 0.01,
    iterationsPerTemperature: 100
  },
  
  penalties: {
    partnerRepeat: 3.0,
    opponentRepeat: 2.0,
    generalRepeat: 1.0,
    matchSeparationViolation: 10.0,
    redBlueImbalance: 2.0,
    stationImbalance: 0.5
  },
  
  constraints: {
    minMatchSeparation: 1,
    enableSurrogates: true,
    surrogateRound: 3,
    enforceRoundUniformity: true
  },
  
  stationBalancing: {
    enabled: true,
    strategy: 'position',
    perfectBalancing: true
  },
  
  allianceBalancing: {
    enabled: true,
    priority: 'preferred'
  },
  
  rounds: {
    count: 6,
    uniformDistribution: true
  }
};

/**
 * Quality level iterations mapping (MatchMaker standard)
 */
export const QUALITY_ITERATIONS = {
  fair: 100000,    // MatchMaker Fair quality
  good: 750000,    // MatchMaker Good quality  
  best: 5000000    // MatchMaker Best quality
} as const;

/**
 * Preset configurations for common tournament formats
 */
export const PRESET_CONFIGS = {
  // Standard FRC Regional (54 teams, 6 rounds, 3v3)
  frcRegional: {
    ...DEFAULT_FRC_CONFIG,
    teamsPerAlliance: 3,
    rounds: { count: 6, uniformDistribution: true },
    qualityLevel: 'good' as const
  },
  
  // Small FRC Event (24 teams, 8 rounds, 3v3)
  frcSmall: {
    ...DEFAULT_FRC_CONFIG,
    teamsPerAlliance: 3,
    rounds: { count: 8, uniformDistribution: true },
    qualityLevel: 'best' as const
  },
  
  // Your current 2v2 format
  current2v2: {
    ...DEFAULT_FRC_CONFIG,
    teamsPerAlliance: 2,
    penalties: {
      ...DEFAULT_FRC_CONFIG.penalties,
      partnerRepeat: 3.0,  // Higher weight since fewer partners
      opponentRepeat: 2.0
    }
  },
  
  // Single robot format (1v1)
  current1v1: {
    ...DEFAULT_FRC_CONFIG,
    teamsPerAlliance: 1,
    penalties: {
      ...DEFAULT_FRC_CONFIG.penalties,
      partnerRepeat: 0.0,  // No partners in 1v1
      opponentRepeat: 3.0, // Higher weight since only 1 opponent per match
      generalRepeat: 1.5   // Increased general repeat penalty
    }
  },
  
  // Fast/Testing configuration
  fast: {
    ...DEFAULT_FRC_CONFIG,
    qualityLevel: 'fair' as const,
    simulatedAnnealing: {
      initialTemperature: 50.0,
      coolingRate: 0.9,
      minTemperature: 0.1,
      iterationsPerTemperature: 50
    }
  }
} as const;
