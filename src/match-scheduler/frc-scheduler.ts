import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Match as PrismaMatch, MatchState, AllianceColor } from '../utils/prisma-types';
import { Match, Schedule } from './match-scheduler.types';
import { FrcSchedulerConfig, DEFAULT_FRC_CONFIG, QUALITY_ITERATIONS, PRESET_CONFIGS } from './frc-scheduler.config';

/**
 * FRC-style schedule generation and optimization logic.
 * Extracted from MatchSchedulerService for separation of concerns.
 * Now configurable based on MatchMaker algorithm principles.
 */
@Injectable()
export class FrcScheduler {
  // Dynamic configuration - replaces hardcoded constants
  private config: FrcSchedulerConfig;
  
  // Computed values based on configuration
  private get teamsPerMatch(): number {
    return this.config.teamsPerAlliance * this.config.alliancesPerMatch;
  }
  
  private get totalStations(): number {
    return this.config.teamsPerAlliance * this.config.alliancesPerMatch;
  }

  constructor(private readonly prisma: PrismaService) {
    this.config = this.cloneConfig(DEFAULT_FRC_CONFIG);
  }

  /**
   * Set custom configuration for the scheduler
   */
  setConfig(config: Partial<FrcSchedulerConfig>): void {
    this.config = this.mergeConfig(DEFAULT_FRC_CONFIG, this.config, config);
  }

  /**
   * Load a preset configuration
   */
  loadPreset(preset: keyof typeof PRESET_CONFIGS): void {
    const presetConfig = PRESET_CONFIGS[preset];
    if (!presetConfig) {
      throw new Error(`Unknown FRC scheduler preset: ${preset}`);
    }
    this.config = this.mergeConfig(DEFAULT_FRC_CONFIG, presetConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): FrcSchedulerConfig {
    return this.cloneConfig(this.config);
  }

  /**
   * Get iterations based on quality level
   */
  private getIterationsForQuality(): number {
    if (this.config.qualityLevel === 'custom') {
      return this.config.customIterations || QUALITY_ITERATIONS.good;
    }
    return QUALITY_ITERATIONS[this.config.qualityLevel];
  }

  async generateFrcSchedule(
    stage: any,
    rounds?: number,
    minMatchSeparation?: number,
    maxIterations?: number,
    qualityLevel?: 'low' | 'medium' | 'high',
    teamsPerAlliance?: number
  ): Promise<PrismaMatch[]> {
    // Override config with provided parameters
    if (rounds !== undefined) {
      this.config.rounds.count = rounds;
    }

    if (teamsPerAlliance !== undefined) {
      this.config.teamsPerAlliance = teamsPerAlliance;
    } else if (stage?.teamsPerAlliance) {
      this.config.teamsPerAlliance = stage.teamsPerAlliance;
    }
    if (minMatchSeparation !== undefined) {
      this.config.constraints.minMatchSeparation = minMatchSeparation;
    }
    if (qualityLevel !== undefined) {
      // Map old quality levels to new ones
      const qualityMap = { low: 'fair', medium: 'good', high: 'best' } as const;
      this.config.qualityLevel = qualityMap[qualityLevel] as any;
    }

    const teams = stage.tournament.teams;
    const numTeams = teams.length;
    const fields = stage.tournament.fields;
    
    if (!fields || fields.length === 0) {
      throw new Error('No fields found for this tournament.');
    }
    
    const shuffledFields = [...fields].sort(() => Math.random() - 0.5);
    const fieldAssignmentCounts = new Array(shuffledFields.length).fill(0);
    
    if (numTeams < this.teamsPerMatch) {
      throw new Error(`Not enough teams (${numTeams}) to create a schedule. Minimum required: ${this.teamsPerMatch}`);
    }
    
    const teamIdMap = new Map<number, string>();
    teams.forEach((team, idx) => {
      const numId = idx + 1;
      teamIdMap.set(numId, team.id);
    });
    
    // Determine iterations based on quality level
    const iterations = maxIterations || this.getIterationsForQuality();
    
    let schedule = this.generateInitialSchedule(numTeams, this.config.rounds.count);
    schedule = this.optimizeSchedule(schedule, iterations, this.config.constraints.minMatchSeparation);
    
    const createdMatches: PrismaMatch[] = [];
    let matchNumber = 1;
    
    for (const match of schedule.matches) {
      const redTeamIds = match.redAlliance.map(id => teamIdMap.get(id));
      const blueTeamIds = match.blueAlliance.map(id => teamIdMap.get(id));
      
      let minCount = Math.min(...fieldAssignmentCounts);
      let candidateIndexes = fieldAssignmentCounts
        .map((count, idx) => (count === minCount ? idx : -1))
        .filter(idx => idx !== -1);      
      let chosenIdx = candidateIndexes[Math.floor(Math.random() * candidateIndexes.length)];
      let chosenField = shuffledFields[chosenIdx];
      fieldAssignmentCounts[chosenIdx]++;
      // Calculate scheduled time with field-based intervals
      const fieldNumber = chosenField.number || 1;
      const fieldOffset = (fieldNumber - 1) * 5 * 60 * 1000; // 5 minutes between fields
      const matchOffset = (matchNumber - 1) * 10 * 60 * 1000; // 10 minutes between matches
      const scheduledTime = new Date(Date.now() + matchOffset + fieldOffset);

      const dbMatch = await this.prisma.match.create({
        data: {
          stageId: stage.id,
          matchNumber: matchNumber++,
          roundNumber: 1,
          scheduledTime,
          status: MatchState.PENDING,
          fieldId: chosenField.id,
          // fieldNumber removed - can access via match.field.number relationship
          alliances: {
            create: [
              {
                color: AllianceColor.RED,
                teamAlliances: {
                  create: redTeamIds.map((teamId, idx) => ({
                    stationPosition: idx + 1,
                    isSurrogate: match.surrogates?.includes(match.redAlliance[idx]) || false,
                    team: { connect: { id: teamId } },
                  })),
                },
              },              {
                color: AllianceColor.BLUE,
                teamAlliances: {
                  create: blueTeamIds.map((teamId, idx) => ({
                    stationPosition: idx + 1,
                    isSurrogate: match.surrogates?.includes(match.blueAlliance[idx]) || false,
                    team: { connect: { id: teamId } },
                  })),
                },
              },
            ],
          },
        },
        include: {
          stage: { select: { name: true } },
          alliances: {
            include: {
              teamAlliances: { include: { team: true } },
            },
          },
        },
      });
      createdMatches.push(dbMatch as any);
    }
    return createdMatches;
  }

  private cloneConfig(config: FrcSchedulerConfig): FrcSchedulerConfig {
    return JSON.parse(JSON.stringify(config));
  }

  private mergeConfig(
    base: FrcSchedulerConfig,
    ...configs: Array<Partial<FrcSchedulerConfig> | FrcSchedulerConfig>
  ): FrcSchedulerConfig {
    const result = this.cloneConfig(base);
    for (const config of configs) {
      this.deepMerge(result as Record<string, any>, config as Record<string, any>);
    }
    return result;
  }

  private deepMerge(target: Record<string, any>, source?: Record<string, any>): void {
    if (!source) {
      return;
    }

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) {
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        this.deepMerge(target[key], value as Record<string, any>);
        continue;
      }

      target[key] = value;
    }
  }

  private optimizeSchedule(schedule: Schedule, maxIterations: number, minMatchSeparation: number): Schedule {
    schedule.score = this.calculateScheduleScore(schedule, minMatchSeparation);
    let bestSchedule = this.cloneSchedule(schedule);
    let bestScore = schedule.score;
    let temperature = this.config.simulatedAnnealing.initialTemperature;
    
    for (let iteration = 0; iteration < maxIterations && temperature > this.config.simulatedAnnealing.minTemperature; iteration++) {
      if (iteration % 1000 === 0) {
        // Optionally log progress
      }
      
      const neighbor = this.generateNeighborSchedule(schedule);
      const neighborScore = this.calculateScheduleScore(neighbor, minMatchSeparation);
      neighbor.score = neighborScore;
      
      const acceptanceProbability = this.calculateAcceptanceProbability(schedule.score, neighborScore, temperature);
      if (acceptanceProbability > Math.random()) {
        schedule = neighbor;
        if (schedule.score < bestScore) {
          bestSchedule = this.cloneSchedule(schedule);
          bestScore = schedule.score;
        }
      }
      
      if (iteration % this.config.simulatedAnnealing.iterationsPerTemperature === 0) {
        temperature *= this.config.simulatedAnnealing.coolingRate;
      }
    }
    
    return bestSchedule;
  }

  private calculateAcceptanceProbability(currentScore: number, newScore: number, temperature: number): number {
    if (newScore < currentScore) return 1.0;
    if (temperature < 0.0001) return 0.0;
    const scoreDelta = newScore - currentScore;
    return Math.exp(-scoreDelta / temperature);
  }

  private generateNeighborSchedule(schedule: Schedule): Schedule {
    const newSchedule = this.cloneSchedule(schedule);
    const matches = newSchedule.matches;
    
    if (matches.length >= 2) {
      const match1Index = Math.floor(Math.random() * matches.length);
      let match2Index = Math.floor(Math.random() * (matches.length - 1));
      if (match2Index >= match1Index) match2Index++;
      
      const match1 = matches[match1Index];
      const match2 = matches[match2Index];
      
      const alliance1 = Math.random() < 0.5 ? 'redAlliance' : 'blueAlliance';
      const alliance2 = Math.random() < 0.5 ? 'redAlliance' : 'blueAlliance';
      
      const pos1 = Math.floor(Math.random() * this.config.teamsPerAlliance);
      const pos2 = Math.floor(Math.random() * this.config.teamsPerAlliance);
      
      const tmp = match1[alliance1][pos1];
      match1[alliance1][pos1] = match2[alliance2][pos2];
      match2[alliance2][pos2] = tmp;
      
      this.recalculateTeamStats(newSchedule);
    }
    
    return newSchedule;
  }

  private recalculateTeamStats(schedule: Schedule): void {
    for (const team of schedule.teamStats.keys()) {
      schedule.teamStats.set(team, {
        appearances: [],
        partners: new Map(),
        opponents: new Map(),
        redCount: 0,
        blueCount: 0,
        stationAppearances: Array(this.totalStations).fill(0)
      });
    }
    for (let matchIndex = 0; matchIndex < schedule.matches.length; matchIndex++) {
      this.updateTeamStats(schedule, schedule.matches[matchIndex], matchIndex);
    }
  }

  private cloneSchedule(schedule: Schedule): Schedule {
    const clonedMatches = schedule.matches.map(match => ({
      matchNumber: match.matchNumber,
      redAlliance: [...match.redAlliance],
      blueAlliance: [...match.blueAlliance],
      surrogates: match.surrogates ? [...match.surrogates] : undefined
    }));
    const clonedTeamStats = new Map();
    for (const [team, stats] of schedule.teamStats.entries()) {
      const clonedPartners = new Map();
      for (const [partner, count] of stats.partners.entries()) {
        clonedPartners.set(partner, count);
      }
      const clonedOpponents = new Map();
      for (const [opponent, count] of stats.opponents.entries()) {
        clonedOpponents.set(opponent, count);
      }
      clonedTeamStats.set(team, {
        appearances: [...stats.appearances],
        partners: clonedPartners,
        opponents: clonedOpponents,
        redCount: stats.redCount,
        blueCount: stats.blueCount,
        stationAppearances: [...stats.stationAppearances]
      });
    }
    return {
      matches: clonedMatches,
      score: schedule.score,
      teamStats: clonedTeamStats
    };
  }

  private calculateScheduleScore(schedule: Schedule, minMatchSeparation: number): number {
    let score = 0;
    
    for (const [, stats] of schedule.teamStats.entries()) {
      // Partner repeat penalties
      for (const [, partnerCount] of stats.partners.entries()) {
        if (partnerCount > 1) {
          score += this.config.penalties.partnerRepeat * (partnerCount - 1);
        }
      }
      
      // Opponent repeat penalties
      for (const [, opponentCount] of stats.opponents.entries()) {
        if (opponentCount > 1) {
          score += this.config.penalties.opponentRepeat * (opponentCount - 1);
        }
      }
      
      // Match separation violations
      for (let i = 0; i < stats.appearances.length - 1; i++) {
        const currentMatch = stats.appearances[i];
        const nextMatch = stats.appearances[i + 1];
        const separation = nextMatch - currentMatch;
        if (separation < minMatchSeparation) {
          score += (minMatchSeparation - separation) * this.config.penalties.matchSeparationViolation;
        }
      }
      
      // Red/Blue alliance imbalance
      const redBlueImbalance = Math.abs(stats.redCount - stats.blueCount);
      score += redBlueImbalance * this.config.penalties.redBlueImbalance;
      
      // Station position imbalance
      if (this.config.stationBalancing.enabled) {
        const expectedAppearancesPerStation = stats.appearances.length / this.totalStations;
        for (const stationCount of stats.stationAppearances) {
          score += Math.abs(stationCount - expectedAppearancesPerStation) * this.config.penalties.stationImbalance;
        }
      }
    }
    
    return score;
  }

  private updateTeamStats(schedule: Schedule, match: Match, matchIndex?: number): void {
    const matchNum = matchIndex !== undefined ? matchIndex : match.matchNumber - 1;
    
    // Update red alliance stats
    for (let i = 0; i < match.redAlliance.length; i++) {
      const team = match.redAlliance[i];
      const teamStats = schedule.teamStats.get(team);
      if (teamStats) {
        teamStats.appearances.push(matchNum);
        teamStats.redCount++;
        teamStats.stationAppearances[i]++;
        
        // Track partners
        for (let j = 0; j < match.redAlliance.length; j++) {
          if (i === j) continue;
          const partner = match.redAlliance[j];
          const currentCount = teamStats.partners.get(partner) || 0;
          teamStats.partners.set(partner, currentCount + 1);
        }
        
        // Track opponents
        for (const opponent of match.blueAlliance) {
          const currentCount = teamStats.opponents.get(opponent) || 0;
          teamStats.opponents.set(opponent, currentCount + 1);
        }
      }
    }
    
    // Update blue alliance stats
    for (let i = 0; i < match.blueAlliance.length; i++) {
      const team = match.blueAlliance[i];
      const teamStats = schedule.teamStats.get(team);
      if (teamStats) {
        teamStats.appearances.push(matchNum);
        teamStats.blueCount++;
        teamStats.stationAppearances[i + this.config.teamsPerAlliance]++;
        
        // Track partners
        for (let j = 0; j < match.blueAlliance.length; j++) {
          if (i === j) continue;
          const partner = match.blueAlliance[j];
          const currentCount = teamStats.partners.get(partner) || 0;
          teamStats.partners.set(partner, currentCount + 1);
        }
        
        // Track opponents
        for (const opponent of match.redAlliance) {
          const currentCount = teamStats.opponents.get(opponent) || 0;
          teamStats.opponents.set(opponent, currentCount + 1);
        }
      }
    }
  }

  private generateInitialSchedule(numTeams: number, rounds: number): Schedule {
    const matches: Match[] = [];
    const totalMatches = Math.ceil((numTeams * rounds) / this.teamsPerMatch);
    const teamStats = new Map();
    
    // Initialize team stats
    for (let i = 1; i <= numTeams; i++) {
      teamStats.set(i, {
        appearances: [],
        partners: new Map(),
        opponents: new Map(),
        redCount: 0,
        blueCount: 0,
        stationAppearances: Array(this.totalStations).fill(0)
      });
    }
    
    let matchNumber = 1;
    let matchesNeeded = totalMatches;
    
    if (numTeams % this.teamsPerMatch === 0) {
      // Even division - simple round-robin style assignment
      while (matchesNeeded > 0) {
        const match: Match = {
          matchNumber: matchNumber++,
          redAlliance: [],
          blueAlliance: []
        };
        
        // Assign teams to red alliance
        for (let i = 0; i < this.config.teamsPerAlliance; i++) {
          const teamIndex = ((matchNumber - 1) * this.teamsPerMatch + i) % numTeams;
          match.redAlliance.push(teamIndex + 1);
        }
        
        // Assign teams to blue alliance
        for (let i = 0; i < this.config.teamsPerAlliance; i++) {
          const teamIndex = ((matchNumber - 1) * this.teamsPerMatch + i + this.config.teamsPerAlliance) % numTeams;
          match.blueAlliance.push(teamIndex + 1);
        }
        
        matches.push(match);
        this.updateTeamStats({ matches, score: 0, teamStats }, match, matches.length - 1);
        matchesNeeded--;
      }
    } else {
      // Odd teams - use appearance tracking for balance (MatchMaker surrogate approach)
      const teamAppearances = Array(numTeams + 1).fill(0);
      
      while (matchesNeeded > 0) {
        const match: Match = {
          matchNumber: matchNumber++,
          redAlliance: [],
          blueAlliance: [],
          surrogates: []
        };
        
        // Sort teams by least appearances first (MatchMaker principle)
        const sortedTeams = Array.from({ length: numTeams }, (_, i) => i + 1)
          .sort((a, b) => teamAppearances[a] - teamAppearances[b]);
        
        // Assign teams to red alliance
        for (let i = 0; i < this.config.teamsPerAlliance; i++) {
          if (match.redAlliance.length < this.config.teamsPerAlliance) {
            const team = sortedTeams[i];
            match.redAlliance.push(team);
            teamAppearances[team]++;
          }
        }
        
        // Assign teams to blue alliance
        for (let i = 0; i < this.config.teamsPerAlliance; i++) {
          if (match.blueAlliance.length < this.config.teamsPerAlliance) {
            const team = sortedTeams[i + this.config.teamsPerAlliance];
            match.blueAlliance.push(team);
            teamAppearances[team]++;
          }
        }
        
        matches.push(match);
        this.updateTeamStats({ matches, score: 0, teamStats }, match, matches.length - 1);
        matchesNeeded--;
      }
    }
    
    return { matches, score: 0, teamStats };
  }
}
