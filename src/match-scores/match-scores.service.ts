import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { CreateMatchScoresDto, UpdateMatchScoresDto } from './dto';
import { ScoreCalculationService } from './services/score-calculation.service';
import { AllianceRepository } from './services/alliance.repository';
import { MatchResultService } from './services/match-result.service';
import { ITeamStatsService } from './interfaces/team-stats.interface';
import { ScoreDataDto } from './dto/score-data.dto';
import { PrismaService } from '../prisma.service';
import { RankingUpdateService } from './ranking-update.service';
import { StagesService } from '../stages/stages.service';


@Injectable()
export class MatchScoresService {
  private readonly logger = new Logger(MatchScoresService.name);

  constructor(
    private readonly scoreCalculationService: ScoreCalculationService,
    private readonly allianceRepository: AllianceRepository,
    private readonly matchResultService: MatchResultService,
    private readonly prisma: PrismaService,
    private readonly rankingUpdateService: RankingUpdateService,
    private readonly stagesService: StagesService,
    @Inject('ITeamStatsService') private readonly teamStatsService: ITeamStatsService
  ) {}
  /**
   * @param createMatchScoresDto - DTO with match score data
   * @returns Legacy format match scores for backward compatibility
   */
  async create(createMatchScoresDto: CreateMatchScoresDto) {
    try {
      // Step 1: Validate and extract score data
      const scoreData = ScoreDataDto.fromCreateDto(createMatchScoresDto);
      scoreData.validate();

      // Step 2: Validate match has required alliances
      const { red: redAlliance, blue: blueAlliance } =
        await this.allianceRepository.validateMatchAlliances(scoreData.matchId);

      // Step 3: Calculate scores based on the new tournament rules
      const matchScores = scoreData.hasDetailedInputs()
        ? this.scoreCalculationService.calculateMatchScores(
            scoreData.redAlliance,
            scoreData.blueAlliance,
          )
        : this.scoreCalculationService.buildLegacyMatchScores(
            scoreData.getLegacyScores(),
            scoreData.redAlliance,
            scoreData.blueAlliance,
          );

      const { redScores, blueScores, winningAlliance } = matchScores;

      // Step 4: Persist alliance scores (autoScore and driveScore now map to component totals)
      await this.allianceRepository.updateAllianceScores(redAlliance.id, {
        autoScore: redScores.autoScore,
        driveScore: redScores.driveScore,
        totalScore: redScores.totalScore,
      });
      await this.allianceRepository.updateAllianceScores(blueAlliance.id, {
        autoScore: blueScores.autoScore,
        driveScore: blueScores.driveScore,
        totalScore: blueScores.totalScore,
      });

      // Step 5: Update match winner
      await this.matchResultService.updateMatchWinner(scoreData.matchId, winningAlliance);

      // Step 6: Update team statistics
      await this.updateTeamStatistics(scoreData.matchId);

      const scoreDetailsPayload = {
        red: { ...redScores.input },
        blue: { ...blueScores.input },
        breakdown: {
          red: { ...redScores.breakdown },
          blue: { ...blueScores.breakdown },
        },
        metadata: {
          scoringMode: scoreData.hasDetailedInputs() ? 'detailed' : 'legacy',
        },
      } as any;

      // Step 7: Persist detailed score breakdown for retrieval
      await this.prisma.matchScoreDetail.upsert({
        where: { matchId: scoreData.matchId },
        create: {
          matchId: scoreData.matchId,
          scoreDetails: scoreDetailsPayload,
        },
        update: {
          scoreDetails: scoreDetailsPayload,
        },
      });

      // Step 8: Return legacy format with detailed breakdown for backward compatibility
      return {
        id: scoreData.matchId,
        matchId: scoreData.matchId,
        redAutoScore: redScores.autoScore,
        redDriveScore: redScores.driveScore,
        redPenaltyScore: 0,
        redPenaltyGiven: 0,
        redTotalScore: redScores.totalScore,
        blueAutoScore: blueScores.autoScore,
        blueDriveScore: blueScores.driveScore,
        bluePenaltyScore: 0,
        bluePenaltyGiven: 0,
        blueTotalScore: blueScores.totalScore,
        scoreDetails: scoreDetailsPayload,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      // Add context to the error
      throw new BadRequestException(`Failed to create match scores: ${error.message}`);
    }
  }

  /**
   * Updates team statistics after score changes
   */
  private async updateTeamStatistics(matchId: string): Promise<void> {
    const matchWithDetails = await this.matchResultService.getMatchWithDetails(matchId);
    
    if (matchWithDetails) {
      const teamIds = this.matchResultService.extractTeamIds(matchWithDetails);
      await this.teamStatsService.recalculateTeamStats(matchWithDetails, teamIds);

      await this.rankingUpdateService.triggerRankingUpdate(
        matchWithDetails.stage.tournament.id,
        matchWithDetails.stage.id,
        matchId
      );

      await this.safeBroadcastBracket(matchWithDetails.stage.id);
    }
  }

  private async safeBroadcastBracket(stageId: string): Promise<void> {
    try {
      await this.stagesService.broadcastStageBracket(stageId);
    } catch (error) {
      this.logger.warn(`Failed to broadcast bracket update for stage ${stageId}: ${error.message}`);
    }
  }

  /**
   * Finds match scores by match ID
   */
  async findByMatchId(matchId: string) {
    try {
      const alliances = await this.allianceRepository.getAlliancesForMatch(matchId);
      const detail = await this.prisma.matchScoreDetail.findUnique({
        where: { matchId },
      });

      return this.convertAlliancesToLegacyFormat(matchId, alliances, detail?.scoreDetails ?? null);
    } catch (error) {
      throw new NotFoundException(`Failed to find match scores for match ${matchId}: ${error.message}`);
    }
  }
  /**
   * Find all match scores - returns legacy format for backward compatibility
   */
  async findAll() {
    try {
      const matchesWithAlliances = await this.allianceRepository.getAllMatchesWithAlliances();

      const matchIds = matchesWithAlliances.map(({ matchId }) => matchId);
      const details = await this.prisma.matchScoreDetail.findMany({
        where: { matchId: { in: matchIds } },
      });
      const detailMap = new Map(details.map(detail => [detail.matchId, detail.scoreDetails]));

      return matchesWithAlliances.map(({ matchId, alliances }) =>
        this.convertAlliancesToLegacyFormat(matchId, alliances, detailMap.get(matchId) ?? null)
      );
    } catch (error) {
      throw new BadRequestException(`Failed to retrieve all match scores: ${error.message}`);
    }
  }

  /**
   * Find match scores by ID - returns legacy format for backward compatibility
   */
  async findOne(id: string) {
    return this.findByMatchId(id);
  }

  /**
   * Updates match scores using the simplified Alliance-based scoring
   */
  async update(id: string, updateMatchScoresDto: UpdateMatchScoresDto) {
    return this.create({
      ...updateMatchScoresDto,
      matchId: updateMatchScoresDto.matchId || id,
    } as CreateMatchScoresDto);
  }

  /**
   * Resets alliance scores to zero for a match
   */
  async remove(matchId: string) {
    try {
      // Validate match exists
      await this.allianceRepository.getAlliancesForMatch(matchId);

      // Reset alliance scores
      await this.allianceRepository.resetAllianceScores(matchId);

      // Reset match winner
      await this.matchResultService.resetMatchWinner(matchId);

      // Remove persisted score details if present
      await this.prisma.matchScoreDetail.delete({
        where: { matchId },
      }).catch(() => undefined);

      return { message: `Reset scores for match ${matchId}` };
    } catch (error) {
      throw new BadRequestException(`Failed to reset match scores: ${error.message}`);
    }
  }

  /**
   * Converts alliance data to legacy format
   */
  private convertAlliancesToLegacyFormat(matchId: string, alliances: any[], scoreDetails: any | null = null) {
    const redAlliance = alliances.find(a => a.color === 'RED');
    const blueAlliance = alliances.find(a => a.color === 'BLUE');

    return {
      id: matchId,
      matchId,
      redAutoScore: redAlliance?.autoScore || 0,
      redDriveScore: redAlliance?.driveScore || 0,
      redTotalScore: redAlliance?.totalScore || 0,
      blueAutoScore: blueAlliance?.autoScore || 0,
      blueDriveScore: blueAlliance?.driveScore || 0,
      blueTotalScore: blueAlliance?.totalScore || 0,
      scoreDetails,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}
