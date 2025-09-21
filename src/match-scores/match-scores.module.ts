import { Module } from '@nestjs/common';
import { MatchScoresService } from './match-scores.service';
import { MatchScoresController } from './match-scores.controller';
import { PrismaService } from '../prisma.service';
import { ScoreCalculationService } from './services/score-calculation.service';
import { AllianceRepository } from './services/alliance.repository';
import { MatchResultService } from './services/match-result.service';
import { TeamStatsService } from './team-stats.service';
import { ITeamStatsService } from './interfaces/team-stats.interface';
import { RankingUpdateService } from './ranking-update.service';
import { TeamStatsApiService } from './team-stats-api.service';
import { StagesModule } from '../stages/stages.module';


@Module({
  imports: [StagesModule],
  controllers: [MatchScoresController],
  providers: [
    MatchScoresService,
    PrismaService,
    ScoreCalculationService,
    AllianceRepository,
    MatchResultService,
    TeamStatsApiService,
    RankingUpdateService,
    {
      provide: 'ITeamStatsService',
      useClass: TeamStatsService,
    },
    {
      provide: TeamStatsService,
      useExisting: 'ITeamStatsService',
    },
  ],
  exports: [MatchScoresService]
})
export class MatchScoresModule {}
