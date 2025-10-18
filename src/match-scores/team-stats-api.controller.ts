import { Controller, Get, Param, Query, Post, Body, BadRequestException } from '@nestjs/common';
import { TeamStatsApiService } from './team-stats-api.service';
import { TeamStatsFilterDto } from './dto/team-stats-filter.dto';
import { TeamStatsResponseDto } from './dto/team-stats-response.dto';
import { LeaderboardResponseDto } from './dto/leaderboard-response.dto';
import { PrismaService } from '../prisma.service';

@Controller('team-stats')
export class TeamStatsApiController {
  constructor(
    private readonly teamStatsApiService: TeamStatsApiService,
    private readonly prisma: PrismaService
  ) {}

  @Get(':teamId')
  async getTeamStats(
    @Param('teamId') teamId: string,
    @Query('tournamentId') tournamentId?: string,
    @Query('stageId') stageId?: string,
  ): Promise<TeamStatsResponseDto[]> {
    return this.teamStatsApiService.getTeamStats(teamId, tournamentId, stageId);
  }

  @Get('tournament/:tournamentId')
  async getStatsForTournament(
    @Param('tournamentId') tournamentId: string,
    @Query() filter: TeamStatsFilterDto,
  ): Promise<TeamStatsResponseDto[]> {
    return this.teamStatsApiService.getStatsForTournament(tournamentId, filter);
  }

  @Get('leaderboard/:tournamentId')
  async getLeaderboard(
    @Param('tournamentId') tournamentId: string,
    @Query() filter: TeamStatsFilterDto,
  ): Promise<LeaderboardResponseDto> {
    return this.teamStatsApiService.getLeaderboard(tournamentId, filter);
  }

  @Post('update-rankings')
  async updateRankings(
    @Query('tournamentId') tournamentId: string,
    @Query('stageId') stageId?: string
  ): Promise<{ success: boolean }> {
    if (!tournamentId) {
      throw new BadRequestException('tournamentId is required');
    }

    // Check if stage is Swiss before allowing ranking updates
    if (stageId) {
      const stage = await this.prisma.stage.findUnique({
        where: { id: stageId },
        select: { type: true }
      });

      if (!stage || stage.type !== 'SWISS') {
        throw new BadRequestException(`Ranking updates are only available for Swiss stages, not ${stage?.type || 'unknown'} stages`);
      }
    }

    await this.teamStatsApiService.calculateAndWriteRankings(tournamentId, stageId);
    return { success: true };
  }

  @Post('recalculate-all')
  async recalculateAllStats(
    @Query('tournamentId') tournamentId: string,
    @Query('stageId') stageId?: string
  ): Promise<{ success: boolean; message: string; recalculatedCount: number }> {
    if (!tournamentId) {
      throw new BadRequestException('tournamentId is required');
    }
    const result = await this.teamStatsApiService.recalculateAllTeamStats(tournamentId, stageId);
    return { 
      success: true, 
      message: result.message,
      recalculatedCount: result.recalculatedCount
    };
  }

  @Get('debug/:tournamentId')
  async debugTournamentData(
    @Param('tournamentId') tournamentId: string,
    @Query('stageId') stageId?: string
  ) {
    return this.teamStatsApiService.debugTournamentData(tournamentId, stageId);
  }
}
