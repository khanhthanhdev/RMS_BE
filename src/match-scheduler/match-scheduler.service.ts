import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FrcScheduler } from './frc-scheduler';
import { SwissScheduler } from './swiss-scheduler';
import { PlayoffScheduler } from './playoff-scheduler';
import { Match as PrismaMatch, Stage, StageType, StageStatus, MatchState, AllianceColor } from '../utils/prisma-types';
import { SchedulingStrategyFactory } from './factories/scheduling-strategy.factory';
import { FieldAssignmentService } from './services/field-assignment.service';
import { MatchupHistoryService } from './services/matchup-history.service';
import { FrcSchedulerConfig, PRESET_CONFIGS } from './frc-scheduler.config';
import { 
  SwissSchedulingOptions, 
  FrcSchedulingOptions, 
  PlayoffSchedulingOptions 
} from './interfaces/scheduling-strategy.interface';




/**
 * Main Match Scheduler Service
 * Coordinates different scheduling strategies and provides a unified interface
 */
@Injectable()
export class MatchSchedulerService {
  private readonly logger = new Logger(MatchSchedulerService.name);
  private readonly DEFAULT_TEAMS_PER_ALLIANCE = 2;

  // Legacy schedulers - to be phased out gradually
  private frcScheduler: FrcScheduler;
  private swissScheduler: SwissScheduler;
  private playoffScheduler: PlayoffScheduler;

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingStrategyFactory: SchedulingStrategyFactory,
    private readonly fieldAssignmentService: FieldAssignmentService,
    private readonly matchupHistoryService: MatchupHistoryService
  ) {
    // Initialize legacy schedulers for backward compatibility
    this.frcScheduler = new FrcScheduler(prisma);
    this.swissScheduler = new SwissScheduler(prisma);
    this.playoffScheduler = new PlayoffScheduler(prisma);
  }  /**
   * Generates matches using the appropriate scheduling strategy
   * @param stageId ID of the stage to generate matches for
   * @param options Scheduling options specific to the strategy
   * @returns Array of created match objects
   */
  async generateMatches(stageId: string, options: SwissSchedulingOptions | FrcSchedulingOptions | PlayoffSchedulingOptions): Promise<PrismaMatch[]> {
    this.logger.log(`Generating matches for stage ${stageId}`);
    
    const stage = await this.getStageWithDetails(stageId);
    this.validateStageForScheduling(stage);
    
    const strategy = this.schedulingStrategyFactory.createStrategy(stage);
    this.logger.log(`Using ${strategy.getStrategyType()} scheduling strategy`);

    const teamsPerAlliance = this.resolveTeamsPerAlliance(stage, options);
    const normalizedOptions = this.applyTeamsPerAlliance(options, teamsPerAlliance);
    
    return strategy.generateMatches(stage, normalizedOptions);
  }

  /**
   * Generates an FRC-style schedule using simulated annealing algorithm (Legacy method)
   * @deprecated Use generateMatches with FrcSchedulingOptions instead
   */
  async generateFrcSchedule(
    stageId: string, 
    rounds?: number, 
    teamsPerAlliance?: number, 
    minMatchSeparation: number = 1,
    maxIterations?: number,
    qualityLevel: 'low' | 'medium' | 'high' = 'medium',
    config?: Partial<FrcSchedulerConfig>,
    preset?: keyof typeof PRESET_CONFIGS
  ): Promise<PrismaMatch[]> {
    this.logger.warn('generateFrcSchedule is deprecated. Use generateMatches with FrcSchedulingOptions instead.');
    
    // Apply preset if specified
    if (preset) {
      this.frcScheduler.loadPreset(preset);
    }
    
    // Apply custom config if provided
    if (config) {
      this.frcScheduler.setConfig(config);
    }
    
    // Get stage with teams and tournament details
    const stage = await this.getStageWithDetails(stageId);
    this.validateStageForScheduling(stage);
    
    const effectiveTeamsPerAlliance = config?.teamsPerAlliance ?? teamsPerAlliance ?? stage.teamsPerAlliance ?? this.DEFAULT_TEAMS_PER_ALLIANCE;
    this.frcScheduler.setConfig({ teamsPerAlliance: effectiveTeamsPerAlliance });

    return this.frcScheduler.generateFrcSchedule(
      stage,
      rounds,
      minMatchSeparation,
      maxIterations,
      qualityLevel,
      effectiveTeamsPerAlliance
    );
  }

  /**
   * Generates an FRC-style schedule with full configuration control
   */
  async generateFrcScheduleWithConfig(
    stageId: string,
    config: FrcSchedulerConfig
  ): Promise<PrismaMatch[]> {
    this.logger.log(`Generating FRC schedule with custom configuration for stage ${stageId}`);
    
    // Get stage with teams and tournament details
    const stage = await this.getStageWithDetails(stageId);
    this.validateStageForScheduling(stage);

    const mergedConfig: FrcSchedulerConfig = {
      ...config,
      teamsPerAlliance: config.teamsPerAlliance ?? stage.teamsPerAlliance ?? this.DEFAULT_TEAMS_PER_ALLIANCE,
    };

    // Set the configuration
    this.frcScheduler.setConfig(mergedConfig);
    
    return this.frcScheduler.generateFrcSchedule(
      stage,
      mergedConfig.rounds.count,
      mergedConfig.constraints.minMatchSeparation,
      undefined,
      undefined,
      mergedConfig.teamsPerAlliance
    );
  }
    /**
   * Generates a Swiss-style tournament round (Legacy method)
   * @deprecated Use generateMatches with SwissSchedulingOptions instead
   */
  async generateSwissRound(stageId: string, currentRoundNumber: number, teamsPerAlliance?: number): Promise<PrismaMatch[]> {
    this.logger.warn('generateSwissRound is deprecated. Use generateMatches with SwissSchedulingOptions instead.');
    
    const options: SwissSchedulingOptions = {
      currentRoundNumber,
      teamsPerAlliance
    };
    
    return this.generateMatches(stageId, options);
  }

  /**
   * Updates Swiss-style rankings for all teams in a stage.
   * Call this after each round.
   */
  async updateSwissRankings(stageId: string): Promise<void> {
    return this.swissScheduler.updateSwissRankings(stageId);
  }

  /**
   * Returns the current Swiss-style ranking for a stage, ordered by all tiebreakers.
   */
  async getSwissRankings(stageId: string) {
    return this.swissScheduler.getSwissRankings(stageId);
  }
    /**
   * Generates a playoff tournament bracket (Legacy method)
   * @deprecated Use generateMatches with PlayoffSchedulingOptions instead
   */
  async generatePlayoffSchedule(stageId: string, numberOfRounds: number, teamsPerAlliance?: number): Promise<PrismaMatch[]> {
    this.logger.warn('generatePlayoffSchedule is deprecated. Use generateMatches with PlayoffSchedulingOptions instead.');
    
    const options: PlayoffSchedulingOptions = {
      numberOfRounds,
      teamsPerAlliance
    };
    
    return this.generateMatches(stageId, options);
  }

  /**
   * Updates playoff brackets after a match is completed.
   * Advances winning teams to the next round.
   */
  async updatePlayoffBrackets(matchId: string): Promise<PrismaMatch[]> {
    return this.playoffScheduler.updatePlayoffBrackets(matchId);
  }
  /**
   * Finalizes rankings after all playoff matches are complete.
   */
  async finalizePlayoffRankings(stageId: string): Promise<PrismaMatch[]> {
    return this.playoffScheduler.finalizePlayoffRankings(stageId);
  }

  /**
   * Gets stage with all necessary details for scheduling
   * @param stageId Stage ID
   * @returns Stage with tournament, teams, and fields
   */
  private async getStageWithDetails(stageId: string): Promise<Stage & { tournament: any; teams: any[] }> {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      include: {
        tournament: {
          include: {
            teams: true,
            fields: true,
          },
        },
        teams: true,
      },
    });

    if (!stage) {
      throw new NotFoundException(`Stage with ID ${stageId} not found`);
    }

    return stage;
  }
  /**
   * Validates if a stage is ready for scheduling
   * @param stage Stage to validate
   */
  private validateStageForScheduling(stage: Stage & { tournament: any }): void {
    if (stage.status === StageStatus.COMPLETED) {
      throw new BadRequestException(`Stage "${stage.name}" has already been completed`);
    }

    if (!stage.tournament) {
      throw new BadRequestException(`Stage "${stage.name}" has no associated tournament`);
    }
  }

  private resolveTeamsPerAlliance(
    stage: Stage & { tournament: any },
    options: SwissSchedulingOptions | FrcSchedulingOptions | PlayoffSchedulingOptions
  ): number {
    const optionValue = options && typeof options === 'object'
      ? (options as { teamsPerAlliance?: number }).teamsPerAlliance
      : undefined;

    return optionValue ?? stage.teamsPerAlliance ?? this.DEFAULT_TEAMS_PER_ALLIANCE;
  }

  private applyTeamsPerAlliance<T extends { teamsPerAlliance?: number }>(options: T, teamsPerAlliance: number): T {
    if (!options || typeof options !== 'object') {
      return { teamsPerAlliance } as T;
    }

    return Object.assign({}, options, { teamsPerAlliance }) as T;
  }

  // Legacy scheduling methods - to be gradually phased out
}
