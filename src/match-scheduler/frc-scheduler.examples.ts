/**
 * FRC Scheduler Configuration Examples
 * 
 * This file demonstrates how to use the new configurable FRC scheduler
 * based on the MatchMaker algorithm principles.
 */

import { FrcSchedulerConfig, PRESET_CONFIGS, DEFAULT_FRC_CONFIG } from './frc-scheduler.config';

// ================================
// Example 1: Using Preset Configurations
// ================================

/**
 * Use a preset configuration for common tournament formats
 */
export function usePresetExample() {
  // Available presets:
  // - 'frcRegional': Standard FRC Regional (54 teams, 6 rounds, 3v3)
  // - 'frcSmall': Small FRC Event (24 teams, 8 rounds, 3v3)
  // - 'current2v2': Your current 2v2 format
  // - 'fast': Quick testing configuration
  
  const regionalConfig = PRESET_CONFIGS.frcRegional;
  console.log('FRC Regional Config:', regionalConfig);
  
  // API call example:
  // POST /match-scheduler/generate-frc-schedule
  // {
  //   "stageId": "stage-123",
  //   "preset": "frcRegional"
  // }
}

// ================================
// Example 2: Custom Configuration
// ================================

/**
 * Create a custom configuration for your specific needs
 */
export function customConfigExample(): FrcSchedulerConfig {
  const customConfig: FrcSchedulerConfig = {
    // Match format (2v2 like your current setup)
    teamsPerAlliance: 2,
    alliancesPerMatch: 2,
    
    // Use 'best' quality for important tournaments
    qualityLevel: 'best',
    
    // Fine-tune simulated annealing for better results
    simulatedAnnealing: {
      initialTemperature: 150.0,  // Higher than default for more exploration
      coolingRate: 0.98,          // Slower cooling for more thorough search
      minTemperature: 0.001,      // Lower minimum for finer optimization
      iterationsPerTemperature: 150 // More iterations per temperature
    },
    
    // Adjust penalties based on your priorities
    penalties: {
      partnerRepeat: 5.0,         // Very high penalty - avoid repeat partnerships
      opponentRepeat: 2.5,        // Moderate penalty for repeat opponents
      generalRepeat: 1.0,         // Low penalty for general repeats
      matchSeparationViolation: 15.0, // Very high - teams need recovery time
      redBlueImbalance: 3.0,      // Higher than default - fair distribution important
      stationImbalance: 1.0       // Higher than default - position fairness
    },
    
    // Tournament constraints
    constraints: {
      minMatchSeparation: 2,      // Teams must have at least 2 matches between appearances
      enableSurrogates: true,     // Use MatchMaker surrogate system
      surrogateRound: 3,         // Place surrogates in round 3 (FRC standard)
      enforceRoundUniformity: true // Strict round uniformity
    },
    
    // Enable all balancing features
    stationBalancing: {
      enabled: true,
      strategy: 'position',       // Balance by actual positions
      perfectBalancing: true      // Use Caleb Sykes algorithm
    },
    
    allianceBalancing: {
      enabled: true,
      priority: 'strict'          // Aggressively balance red/blue
    },
    
    // Tournament structure
    rounds: {
      count: 8,                   // 8 rounds for good competition
      uniformDistribution: true   // Ensure even distribution
    }
  };
  
  return customConfig;
}

// ================================
// Example 3: Incremental Customization
// ================================

/**
 * Start with a preset and modify specific aspects
 */
export function incrementalCustomizationExample(): FrcSchedulerConfig {
  // Start with the small FRC preset
  const baseConfig = { ...PRESET_CONFIGS.frcSmall };
  
  // Customize for your specific tournament
  const modifiedConfig: FrcSchedulerConfig = {
    ...baseConfig,
    
    // Change to 2v2 format
    teamsPerAlliance: 2,
    
    // Increase quality for important tournament
    qualityLevel: 'best',
    
    // Adjust penalties for 2v2 format (fewer partners/opponents)
    penalties: {
      ...baseConfig.penalties,
      partnerRepeat: 4.0,         // Higher weight since only 1 partner per match
      opponentRepeat: 2.0         // Lower weight since 2 opponents per match
    },
    
    // More aggressive match separation for smaller tournament
    constraints: {
      ...baseConfig.constraints,
      minMatchSeparation: 3       // More recovery time in smaller event
    }
  };
  
  return modifiedConfig;
}

// ================================
// Example 4: Quality Level Comparison
// ================================

/**
 * Understand the trade-offs between quality levels
 */
export function qualityLevelExample() {
  const configs = {
    testing: {
      ...DEFAULT_FRC_CONFIG,
      qualityLevel: 'fair' as const,     // 100,000 iterations - fast for testing
    },
    
    regular: {
      ...DEFAULT_FRC_CONFIG,
      qualityLevel: 'good' as const,     // 750,000 iterations - good balance
    },
    
    championship: {
      ...DEFAULT_FRC_CONFIG,
      qualityLevel: 'best' as const,     // 5,000,000 iterations - highest quality
    },
    
    custom: {
      ...DEFAULT_FRC_CONFIG,
      qualityLevel: 'custom' as const,
      customIterations: 10000000         // Even higher for critical tournaments
    }
  };
  
  // Expected runtime (approximate):
  // fair: ~30 seconds
  // good: ~3-5 minutes  
  // best: ~15-30 minutes
  // custom (10M): ~45-60 minutes
  
  return configs;
}

// ================================
// Example 5: MatchMaker Algorithm Features
// ================================

/**
 * Enable advanced MatchMaker features
 */
export function advancedMatchMakerExample(): FrcSchedulerConfig {
  return {
    ...DEFAULT_FRC_CONFIG,
    
    // Standard FRC 3v3 format
    teamsPerAlliance: 3,
    
    // Enable perfect station balancing (2021 MatchMaker update)
    stationBalancing: {
      enabled: true,
      strategy: 'mirrored',       // R1/B3, R2/B2, R3/B1 pairing
      perfectBalancing: true      // Caleb Sykes algorithm
    },
    
    // Strict surrogate handling (FRC 2008+ standard)
    constraints: {
      minMatchSeparation: 1,
      enableSurrogates: true,
      surrogateRound: 3,          // FRC moved surrogates to round 3 in 2008
      enforceRoundUniformity: true
    },
    
    // MatchMaker-style penalty weighting
    penalties: {
      partnerRepeat: 3.0,         // Slightly higher than opponent (fewer partners)
      opponentRepeat: 2.0,        // Standard weight
      generalRepeat: 1.0,         // Base weight
      matchSeparationViolation: 10.0, // Strong penalty for queue violations
      redBlueImbalance: 2.0,      // Even red/blue distribution
      stationImbalance: 0.5       // Light penalty for station distribution
    },
    
    // Use 'good' quality (MatchMaker standard)
    qualityLevel: 'good'
  };
}

// ================================
// API Usage Examples
// ================================

/**
 * Examples of how to call the API with different configurations
 */
export const apiExamples = {
  // Simple call with preset
  usePreset: {
    endpoint: 'POST /match-scheduler/generate-frc-schedule',
    body: {
      stageId: 'stage-123',
      preset: 'frcRegional'
    }
  },
  
  // Use 1v1 format
  use1v1: {
    endpoint: 'POST /match-scheduler/generate-frc-schedule',
    body: {
      stageId: 'stage-123',
      preset: 'current1v1'
    }
  },
  
  // Use 2v2 format
  use2v2: {
    endpoint: 'POST /match-scheduler/generate-frc-schedule',
    body: {
      stageId: 'stage-123',
      preset: 'current2v2'
    }
  },
  
  // Legacy call with basic parameters
  legacy: {
    endpoint: 'POST /match-scheduler/generate-frc-schedule',
    body: {
      stageId: 'stage-123',
      rounds: 6,
      teamsPerAlliance: 2,
      minMatchSeparation: 2,
      qualityLevel: 'medium'
    }
  },
  
  // Custom configuration override
  customOverride: {
    endpoint: 'POST /match-scheduler/generate-frc-schedule',
    body: {
      stageId: 'stage-123',
      config: {
        teamsPerAlliance: 2,
        penalties: {
          partnerRepeat: 5.0,
          matchSeparationViolation: 20.0
        }
      }
    }
  },
  
  // Full advanced configuration
  advanced: {
    endpoint: 'POST /match-scheduler/generate-frc-schedule-advanced',
    body: {
      stageId: 'stage-123',
      config: customConfigExample()
    }
  },
  
  // Get available presets
  getPresets: {
    endpoint: 'POST /match-scheduler/get-frc-presets',
    body: {}
  }
};

/**
 * Migration guide from old hardcoded values to new configuration
 */
export const migrationGuide = {
  oldHardcoded: {
    RED_ALLIANCE_SIZE: 2,
    BLUE_ALLIANCE_SIZE: 2,
    TEAMS_PER_MATCH: 4,
    PARTNER_REPEAT_WEIGHT: 3.0,
    OPPONENT_REPEAT_WEIGHT: 2.0,
    INITIAL_TEMPERATURE: 100.0,
    COOLING_RATE: 0.95
  },
  
  newConfigurable: {
    teamsPerAlliance: 2,         // Was RED_ALLIANCE_SIZE/BLUE_ALLIANCE_SIZE
    alliancesPerMatch: 2,        // Always 2 (red vs blue)
    penalties: {
      partnerRepeat: 3.0,        // Was PARTNER_REPEAT_WEIGHT
      opponentRepeat: 2.0        // Was OPPONENT_REPEAT_WEIGHT
    },
    simulatedAnnealing: {
      initialTemperature: 100.0, // Was INITIAL_TEMPERATURE
      coolingRate: 0.95          // Was COOLING_RATE
    }
  }
};
