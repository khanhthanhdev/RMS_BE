import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { DateValidationService } from '../common/services/date-validation.service';
import { StageType } from '../utils/prisma-types';
import { getGlobalEventsGateway } from '../match-scores/ranking-update.service';

@Injectable()
export class StagesService {
  private readonly logger = new Logger(StagesService.name);

  constructor(
    private prisma: PrismaService,
    private dateValidationService: DateValidationService
  ) {}

  async create(createStageDto: CreateStageDto) {
    // Validate stage dates against tournament boundaries
    const stageRange = {
      startDate: new Date(createStageDto.startDate),
      endDate: new Date(createStageDto.endDate)
    };

    const dateValidation = await this.dateValidationService.validateStageeDateRange(
      stageRange,
      {
        stageId: '', // Not applicable for creation
        tournamentId: createStageDto.tournamentId
      }
    );

    if (!dateValidation.isValid) {
      throw new BadRequestException(
        `Cannot create stage: ${dateValidation.errors.join('; ')}`
      );
    }

    return this.prisma.stage.create({
      data: {
        name: createStageDto.name,
        description: createStageDto.description,
        type: createStageDto.type,
        startDate: stageRange.startDate,
        endDate: stageRange.endDate,
        tournamentId: createStageDto.tournamentId,
        maxTeams: createStageDto.maxTeams,
        isElimination: createStageDto.isElimination,
        advancementRules: createStageDto.advancementRules,
      },
    });
  }

  findAll() {
    return this.prisma.stage.findMany({
      include: {
        tournament: true,
      },
    });
  }

  findByTournament(tournamentId: string) {
    return this.prisma.stage.findMany({
      where: {
        tournamentId: tournamentId,
      },
      include: {
        tournament: true,
      },
    });
  }

  findOne(id: string) {
    return this.prisma.stage.findUnique({
      where: { id },
      include: {
        tournament: true,
        matches: {
          include: {
            alliances: {
              include: {
                teamAlliances: {
                  include: {
                    team: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async update(id: string, updateStageDto: UpdateStageDto) {
    const data: any = {};
    let dateRangeChanged = false;

    // Validate date range changes if provided
    if (updateStageDto.startDate || updateStageDto.endDate) {
      // Get current stage and tournament info
      const currentStage = await this.prisma.stage.findUnique({
        where: { id },
        select: {
          startDate: true,
          endDate: true,
          tournamentId: true,
          name: true
        }
      });

      if (!currentStage) {
        throw new BadRequestException('Stage not found');
      }

      const newStartDate = updateStageDto.startDate
        ? new Date(updateStageDto.startDate)
        : currentStage.startDate;
      const newEndDate = updateStageDto.endDate
        ? new Date(updateStageDto.endDate)
        : currentStage.endDate;

      // Validate the new date range
      const dateValidation = await this.dateValidationService.validateStageeDateRange(
        { startDate: newStartDate, endDate: newEndDate },
        {
          stageId: id,
          tournamentId: currentStage.tournamentId
        }
      );

      if (!dateValidation.isValid) {
        throw new BadRequestException(
          `Cannot update stage dates: ${dateValidation.errors.join('; ')}`
        );
      }

      dateRangeChanged = true;
    }

    if (updateStageDto.name) {
      data.name = updateStageDto.name;
    }

    if (updateStageDto.description !== undefined) {
      data.description = updateStageDto.description;
    }

    if (updateStageDto.type) {
      data.type = updateStageDto.type;
    }

    if (updateStageDto.startDate) {
      data.startDate = new Date(updateStageDto.startDate);
    }

    if (updateStageDto.endDate) {
      data.endDate = new Date(updateStageDto.endDate);
    }

    if (updateStageDto.maxTeams !== undefined) {
      data.maxTeams = updateStageDto.maxTeams;
    }

    if (updateStageDto.isElimination !== undefined) {
      data.isElimination = updateStageDto.isElimination;
    }

    if (updateStageDto.advancementRules !== undefined) {
      data.advancementRules = updateStageDto.advancementRules;
    }

    return this.prisma.stage.update({
      where: { id },
      data,
    });
  }

  remove(id: string) {
    return this.prisma.stage.delete({
      where: { id },
    });
  }

  async getStageTeams(stageId: string) {
    return this.prisma.team.findMany({
      where: {
        currentStageId: stageId,
      },
      orderBy: {
        teamNumber: 'asc',
      },
    });
  }

  async getStageBracket(stageId: string) {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      include: {
        tournament: { select: { id: true } },
        matches: {
          orderBy: [
            { roundNumber: 'asc' },
            { bracketSlot: 'asc' },
            { matchNumber: 'asc' },
          ],
          include: {
            alliances: {
              include: {
                teamAlliances: {
                  include: {
                    team: true,
                  },
                },
              },
            },
            feedsIntoMatch: {
              select: {
                id: true,
                matchNumber: true,
                roundNumber: true,
                bracketSlot: true,
              },
            },
            loserFeedsIntoMatch: {
              select: {
                id: true,
                matchNumber: true,
                roundNumber: true,
                bracketSlot: true,
              },
            },
          },
        },
      },
    });

    if (!stage) {
      throw new BadRequestException(`Stage ${stageId} not found`);
    }

    const normalizedMatches = stage.matches.map((match) => {
      const alliances = match.alliances.map((alliance) => ({
        id: alliance.id,
        color: alliance.color,
        score: alliance.score,
        autoScore: alliance.autoScore,
        driveScore: alliance.driveScore,
        teamAlliances: alliance.teamAlliances.map((teamAlliance) => ({
          id: teamAlliance.id,
          teamId: teamAlliance.teamId,
          teamNumber: teamAlliance.team?.teamNumber ?? null,
          teamName: teamAlliance.team?.name ?? null,
          stationPosition: teamAlliance.stationPosition,
          isSurrogate: teamAlliance.isSurrogate,
        })),
      }));

      return {
        id: match.id,
        stageId: match.stageId,
        matchNumber: match.matchNumber,
        roundNumber: match.roundNumber ?? null,
        bracketSlot: match.bracketSlot ?? null,
        recordBucket: match.recordBucket,
        status: match.status,
        scheduledTime: match.scheduledTime,
        startTime: match.startTime,
        endTime: match.endTime,
        winningAlliance: match.winningAlliance,
        feedsIntoMatchId: match.feedsIntoMatchId,
        loserFeedsIntoMatchId: match.loserFeedsIntoMatchId,
        feedsIntoMatch: match.feedsIntoMatch
          ? {
              id: match.feedsIntoMatch.id,
              matchNumber: match.feedsIntoMatch.matchNumber,
              roundNumber: match.feedsIntoMatch.roundNumber ?? null,
              bracketSlot: match.feedsIntoMatch.bracketSlot ?? null,
            }
          : null,
        loserFeedsIntoMatch: match.loserFeedsIntoMatch
          ? {
              id: match.loserFeedsIntoMatch.id,
              matchNumber: match.loserFeedsIntoMatch.matchNumber,
              roundNumber: match.loserFeedsIntoMatch.roundNumber ?? null,
              bracketSlot: match.loserFeedsIntoMatch.bracketSlot ?? null,
            }
          : null,
        alliances,
      };
    });

    const structure = this.buildBracketStructure(stage.type, stage.isElimination, normalizedMatches);

    return {
      stageId: stage.id,
      stageName: stage.name,
      tournamentId: stage.tournament.id,
      stageType: stage.type,
      generatedAt: new Date().toISOString(),
      matches: normalizedMatches,
      structure,
    };
  }

  async broadcastStageBracket(stageId: string): Promise<void> {
    try {
      const bracket = await this.getStageBracket(stageId);
      const gateway = getGlobalEventsGateway();

      if (!gateway?.server) {
        this.logger.debug('Events gateway not initialized, skipping bracket broadcast');
        return;
      }

      const eventPayload = {
        type: 'bracket_update',
        stageId: bracket.stageId,
        tournamentId: bracket.tournamentId,
        timestamp: Date.now(),
        bracket,
      };

      gateway.server.to(bracket.tournamentId).emit('bracket_update', eventPayload);
      gateway.server.to(`stage_${bracket.stageId}`).emit('bracket_update', eventPayload);
    } catch (error) {
      this.logger.warn(`Failed to broadcast bracket update for stage ${stageId}: ${error.message}`);
    }
  }

  private buildBracketStructure(stageType: StageType, isElimination: boolean, matches: any[]) {
    if (!matches.length) {
      return {
        type: stageType,
        rounds: [],
      };
    }

    const roundsMap = new Map<number, any[]>();
    matches.forEach((match) => {
      const roundKey = match.roundNumber ?? 0;
      if (!roundsMap.has(roundKey)) {
        roundsMap.set(roundKey, []);
      }
      roundsMap.get(roundKey)!.push(match);
    });

    const sortedRounds = Array.from(roundsMap.entries()).sort((a, b) => a[0] - b[0]);

    if (stageType === StageType.PLAYOFF || isElimination) {
      const meaningfulRounds = sortedRounds.filter(([roundNumber]) => roundNumber !== 0);
      const maxRound = meaningfulRounds.length ? Math.max(...meaningfulRounds.map(([roundNumber]) => roundNumber)) : 0;

      return {
        type: 'elimination',
        rounds: sortedRounds.map(([roundNumber, roundMatches]) => ({
          roundNumber,
          label: this.getEliminationRoundLabel(roundNumber, maxRound),
          matches: roundMatches.map((match) => match.id),
        })),
      };
    }

    if (stageType === StageType.SWISS) {
      const bucketMap = new Map<string, any[]>();
      matches.forEach((match) => {
        const bucket = match.recordBucket || 'unassigned';
        if (!bucketMap.has(bucket)) {
          bucketMap.set(bucket, []);
        }
        bucketMap.get(bucket)!.push(match);
      });

      const parseRecord = (record: string) => {
        const [wins, losses] = record.split('-').map((value) => Number(value));
        if (Number.isNaN(wins) || Number.isNaN(losses)) {
          return { wins: -1, losses: Number.MAX_SAFE_INTEGER };
        }
        return { wins, losses };
      };

      const sortedBuckets = Array.from(bucketMap.entries()).sort(([recordA], [recordB]) => {
        const a = parseRecord(recordA);
        const b = parseRecord(recordB);

        if (a.wins !== b.wins) {
          return b.wins - a.wins;
        }

        return a.losses - b.losses;
      });

      return {
        type: 'swiss',
        buckets: sortedBuckets.map(([record, bucketMatches]) => ({
          record,
          matches: bucketMatches.map((match) => match.id),
        })),
        rounds: sortedRounds.map(([roundNumber, roundMatches]) => ({
          roundNumber,
          matches: roundMatches.map((match) => match.id),
        })),
      };
    }

    return {
      type: 'standard',
      rounds: sortedRounds.map(([roundNumber, roundMatches]) => ({
        roundNumber,
        matches: roundMatches.map((match) => match.id),
      })),
    };
  }

  private getEliminationRoundLabel(roundNumber: number, maxRound: number): string {
    if (!roundNumber) {
      return 'Seeding';
    }

    const roundsRemaining = maxRound - roundNumber;

    if (roundsRemaining <= 0) {
      return 'Finals';
    }

    if (roundsRemaining === 1) {
      return 'Semifinals';
    }

    if (roundsRemaining === 2) {
      return 'Quarterfinals';
    }

    const teams = Math.pow(2, roundsRemaining + 1);
    return `Round of ${teams}`;
  }

  /**
   * Get date boundaries for stage validation
   */
  async getDateBoundaries(stageId: string) {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { tournamentId: true }
    });

    if (!stage) {
      throw new BadRequestException('Stage not found');
    }

    return this.dateValidationService.getDateBoundaries(stage.tournamentId, stageId);
  }

  /**
   * Validate if stage dates can be updated
   */
  async validateDateUpdate(
    stageId: string,
    newStartDate: Date,
    newEndDate: Date
  ) {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      select: { tournamentId: true, name: true }
    });

    if (!stage) {
      throw new BadRequestException('Stage not found');
    }

    const dateRange = { startDate: newStartDate, endDate: newEndDate };

    const dateValidation = await this.dateValidationService.validateStageeDateRange(
      dateRange,
      {
        stageId,
        tournamentId: stage.tournamentId
      }
    );

    return {
      isValid: dateValidation.isValid,
      errors: dateValidation.errors,
      warnings: []
    };
  }
}
