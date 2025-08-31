# FRC Scheduler Configuration Guide

Based on the MatchMaker algorithm documentation, this guide explains how to configure the FRC scheduler for optimal tournament scheduling.

## Overview

The FRC Scheduler now supports full configuration based on the MatchMaker algorithm principles. You can customize:

- **Match Format**: Teams per alliance, alliance structure
- **Quality Settings**: Iteration counts, algorithm parameters  
- **Penalty Weights**: How heavily to penalize different violations
- **Constraints**: Match separation, surrogate handling, round uniformity
- **Balancing**: Station positions, red/blue distribution

## Quick Start

### 1. Using Presets

The easiest way to get started is with preset configurations:

```typescript
// API call
POST /match-scheduler/generate-frc-schedule
{
  "stageId": "stage-123",
  "preset": "frcRegional"  // or "frcSmall", "current2v2", "fast"
}
```

### 2. Basic Customization

Override specific parameters while keeping defaults:

```typescript
POST /match-scheduler/generate-frc-schedule
{
  "stageId": "stage-123",
  "rounds": 8,
  "teamsPerAlliance": 2,
  "qualityLevel": "best",
  "config": {
    "penalties": {
      "partnerRepeat": 5.0,
      "matchSeparationViolation": 20.0
    }
  }
}
```

### 3. Advanced Configuration

For full control, use the advanced endpoint:

```typescript
POST /match-scheduler/generate-frc-schedule-advanced
{
  "stageId": "stage-123",
  "config": {
    "teamsPerAlliance": 3,
    "qualityLevel": "best",
    "simulatedAnnealing": {
      "initialTemperature": 150.0,
      "coolingRate": 0.98
    },
    "penalties": {
      "partnerRepeat": 3.0,
      "opponentRepeat": 2.0,
      "matchSeparationViolation": 15.0
    },
    "constraints": {
      "minMatchSeparation": 2,
      "enableSurrogates": true
    }
  }
}
```

## Configuration Reference

### Match Format

```typescript
{
  "teamsPerAlliance": 3,     // Standard FRC is 3, your current is 2
  "alliancesPerMatch": 2     // Always 2 (Red vs Blue)
}
```

### Quality Levels

Based on MatchMaker standards:

- **`fair`**: 100,000 iterations (~30 seconds)
- **`good`**: 750,000 iterations (~3-5 minutes) 
- **`best`**: 5,000,000 iterations (~15-30 minutes)
- **`custom`**: Specify exact iteration count

### Penalty System

Controls how the algorithm scores schedule quality:

```typescript
{
  "penalties": {
    "partnerRepeat": 3.0,           // Teams partnering multiple times (highest penalty)
    "opponentRepeat": 2.0,          // Teams facing each other multiple times  
    "generalRepeat": 1.0,           // Any repeated interaction
    "matchSeparationViolation": 10.0, // Teams playing too close together (very high)
    "redBlueImbalance": 2.0,        // Uneven red/blue distribution
    "stationImbalance": 0.5         // Uneven station position distribution (lowest)
  }
}
```

### Simulated Annealing Parameters

Fine-tune the optimization algorithm:

```typescript
{
  "simulatedAnnealing": {
    "initialTemperature": 100.0,    // Starting "heat" - higher = more exploration
    "coolingRate": 0.95,            // How fast to cool - slower = more thorough
    "minTemperature": 0.01,         // When to stop - lower = more precision
    "iterationsPerTemperature": 100 // Work per temperature level
  }
}
```

### Constraints

Hard requirements that must be satisfied:

```typescript
{
  "constraints": {
    "minMatchSeparation": 1,        // Minimum matches between team appearances
    "enableSurrogates": true,       // Use MatchMaker surrogate system for odd teams
    "surrogateRound": 3,           // Which round to place surrogates (FRC standard)
    "enforceRoundUniformity": true  // Each team plays exactly once per round
  }
}
```

### Station Balancing

Advanced MatchMaker features:

```typescript
{
  "stationBalancing": {
    "enabled": true,
    "strategy": "position",         // "position" or "mirrored"
    "perfectBalancing": true        // Use Caleb Sykes perfect balancing algorithm
  }
}
```

Strategies:
- **`position`**: Balance R1, R2, R3, B1, B2, B3 individually
- **`mirrored`**: Balance R1/B3, R2/B2, R3/B1 as pairs

### Alliance Balancing

Red vs Blue distribution:

```typescript
{
  "allianceBalancing": {
    "enabled": true,
    "priority": "preferred"         // "strict" or "preferred"
  }
}
```

## Handling Odd Numbers of Teams

The algorithm handles odd team counts using the MatchMaker surrogate system:

### How It Works

1. **Calculate total appearances**: `teams × rounds`
2. **Calculate matches needed**: `ceil(total_appearances ÷ teams_per_match)`  
3. **If not evenly divisible**: Some teams get extra "surrogate" appearances
4. **Surrogate rules**: Extra matches don't count toward team standings

### Example

- **32 teams, 8 rounds**: 256 total appearances ÷ 6 teams per match = 42.67 matches
- **Result**: 43 matches needed, 4 teams get surrogate appearances
- **MatchMaker placement**: Surrogates typically placed in round 3

### Configuration

```typescript
{
  "constraints": {
    "enableSurrogates": true,       // Enable surrogate system
    "surrogateRound": 3,           // Place surrogates in round 3 (FRC 2008+ standard)
    "enforceRoundUniformity": true  // Maintain round structure
  }
}
```

## Algorithm Flow

The MatchMaker-based algorithm follows this process:

### 1. Initial Schedule Generation
- **Even teams**: Simple round-robin distribution
- **Odd teams**: Appearance-balanced assignment with surrogates

### 2. Simulated Annealing Optimization
- Start with high "temperature" (accepts bad moves)
- Gradually cool down (becomes more selective)
- Generate neighbor schedules by swapping teams
- Accept/reject based on score improvement and temperature

### 3. Scoring System
```
Total Score = Σ(
  partner_repeats × partnerRepeat_penalty +
  opponent_repeats × opponentRepeat_penalty +
  separation_violations × separation_penalty +
  red_blue_imbalance × alliance_penalty +
  station_imbalance × station_penalty
)
```

### 4. Final Balancing
- Optimize red/blue alliance distribution
- Balance station position assignments
- Preserve all other constraints

## Best Practices

### For Small Tournaments (< 30 teams)
```typescript
{
  "qualityLevel": "best",           // Use highest quality
  "constraints": {
    "minMatchSeparation": 3         // More recovery time
  },
  "penalties": {
    "partnerRepeat": 5.0,          // Avoid repeats in small field
    "matchSeparationViolation": 20.0
  }
}
```

### For Large Tournaments (> 50 teams)
```typescript
{
  "qualityLevel": "good",           // Balance quality vs time
  "constraints": {
    "minMatchSeparation": 1         // Less separation needed
  },
  "stationBalancing": {
    "perfectBalancing": true        // Use advanced balancing
  }
}
```

### For Testing/Development
```typescript
{
  "qualityLevel": "fair",           // Fast execution
  "simulatedAnnealing": {
    "iterationsPerTemperature": 50  // Quick convergence
  }
}
```

## Migration from Hardcoded Values

If migrating from the old hardcoded system:

| Old Constant | New Configuration |
|--------------|-------------------|
| `RED_ALLIANCE_SIZE: 2` | `teamsPerAlliance: 2` |
| `PARTNER_REPEAT_WEIGHT: 3.0` | `penalties.partnerRepeat: 3.0` |
| `INITIAL_TEMPERATURE: 100.0` | `simulatedAnnealing.initialTemperature: 100.0` |
| `iterationsMap.medium: 10000` | `qualityLevel: "good"` (750,000) |

## Troubleshooting

### Poor Schedule Quality
- Increase `qualityLevel` to "best"
- Increase `simulatedAnnealing.iterationsPerTemperature`
- Decrease `simulatedAnnealing.coolingRate` (slower cooling)

### Too Many Partner/Opponent Repeats
- Increase `penalties.partnerRepeat` and `penalties.opponentRepeat`
- Ensure `constraints.enforceRoundUniformity: true`

### Uneven Red/Blue Distribution
- Set `allianceBalancing.priority: "strict"`
- Increase `penalties.redBlueImbalance`

### Teams Playing Too Close Together
- Increase `constraints.minMatchSeparation`
- Increase `penalties.matchSeparationViolation`

### Algorithm Too Slow
- Use `qualityLevel: "fair"` for testing
- Decrease `simulatedAnnealing.iterationsPerTemperature`
- Increase `simulatedAnnealing.coolingRate` (faster cooling)

## API Endpoints

### Generate with Basic Options
```
POST /match-scheduler/generate-frc-schedule
{
  "stageId": "string",
  "rounds": number,
  "preset": "frcRegional" | "frcSmall" | "current2v2" | "fast",
  "config": Partial<FrcSchedulerConfig>
}
```

### Generate with Full Configuration
```
POST /match-scheduler/generate-frc-schedule-advanced
{
  "stageId": "string", 
  "config": FrcSchedulerConfig
}
```

### Get Available Presets
```
POST /match-scheduler/get-frc-presets
```

This configuration system provides the flexibility of the MatchMaker algorithm while maintaining backward compatibility with your existing API.
