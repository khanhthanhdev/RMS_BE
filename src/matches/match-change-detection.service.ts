/**
 * Match Change Detection Service
 * 
 * Backend service for detecting recent match updates and triggering
 * automatic ranking recalculations when matches are completed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TeamStatsApiService } from '../match-scores/team-stats-api.service';
import { MatchSchedulerService } from '../match-scheduler/match-scheduler.service';
import { MatchState, StageType } from '../utils/prisma-types';

export interface RecentMatchUpdate {
  id: string;
  matchNumber: number;
  status: MatchState;
  updatedAt: Date;
  tournamentId: string;
  stageId: string;
  winningAlliance?: string;
}

export interface MatchChangeEvent {
  matchId: string;
  tournamentId: string;
  stageId: string;
  previousStatus: MatchState;
  newStatus: MatchState;
  timestamp: Date;
  affectedTeamIds: string[];
}

@Injectable()
export class MatchChangeDetectionService {
  private readonly logger = new Logger(MatchChangeDetectionService.name);
  private readonly recentChanges = new Map<string, MatchChangeEvent>();
  private readonly CHANGE_RETENTION_TIME = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly teamStatsService: TeamStatsApiService,
    private readonly matchSchedulerService: MatchSchedulerService
  ) {
    // Periodic cleanup of old change records
    setInterval(() => this.cleanupOldChanges(), 60 * 1000);
  }

  /**
   * Get recent match updates for a tournament/stage
   */
  async getRecentMatchUpdates(
    tournamentId: string,
    stageId?: string,
    since?: number,
    limit = 50
  ): Promise<RecentMatchUpdate[]> {
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 60 * 1000); // Default: last 30 minutes

    const where: any = {
      stage: { tournamentId },
      updatedAt: { gte: sinceDate },
    };

    if (stageId) {
      where.stageId = stageId;
    }

    const matches = await this.prisma.match.findMany({
      where,
      include: {
        stage: {
          include: {
            tournament: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    return matches.map(match => ({
      id: match.id,
      matchNumber: match.matchNumber,
      status: match.status,
      updatedAt: match.updatedAt,
      tournamentId: match.stage.tournament.id,
      stageId: match.stage.id,
      winningAlliance: match.winningAlliance || undefined,
    }));
  }

  /**
   * Record a match status change and trigger ranking updates if needed
   */
  async recordMatchChange(
    matchId: string,
    previousStatus: MatchState,
    newStatus: MatchState
  ): Promise<void> {
    try {
      // Get match details
      const match = await this.prisma.match.findUnique({
        where: { id: matchId },
        include: {
          stage: {
            include: {
              tournament: true,
            },
          },
          alliances: {
            include: {
              teamAlliances: {
                where: { isSurrogate: false },
                include: { team: true },
              },
            },
          },
        },
      });

      if (!match) {
        this.logger.warn(`Match not found: ${matchId}`);
        return;
      }

      const affectedTeamIds = match.alliances.flatMap(alliance =>
        alliance.teamAlliances.map(ta => ta.teamId)
      );

      const changeEvent: MatchChangeEvent = {
        matchId,
        tournamentId: match.stage.tournament.id,
        stageId: match.stage.id,
        previousStatus,
        newStatus,
        timestamp: new Date(),
        affectedTeamIds,
      };

      // Store the change event
      this.recentChanges.set(matchId, changeEvent);

      this.logger.log(
        `Match status changed: ${matchId} (${previousStatus} → ${newStatus}) ` +
        `in tournament ${match.stage.tournament.id}, stage ${match.stage.id}`
      );

      // If match was completed, trigger ranking recalculation only for Swiss stages
      if (newStatus === MatchState.COMPLETED && previousStatus !== MatchState.COMPLETED) {
        if (match.stage.type === StageType.SWISS) {
          await this.triggerRankingRecalculation(changeEvent);
        } else if (match.stage.type === StageType.PLAYOFF) {
          // For playoff stages, only trigger bracket updates
          await this.triggerPlayoffBracketUpdate(changeEvent);
        }
      }
    } catch (error) {
      this.logger.error(`Error recording match change for ${matchId}:`, error);
    }
  }

  /**
   * Trigger automatic ranking recalculation when a Swiss match is completed
   */
  private async triggerRankingRecalculation(changeEvent: MatchChangeEvent): Promise<void> {
    try {
      this.logger.log(
        `Triggering ranking recalculation for tournament ${changeEvent.tournamentId}, ` +
        `stage ${changeEvent.stageId} due to Swiss match completion: ${changeEvent.matchId}`
      );

      // Recalculate rankings for the affected tournament/stage
      await this.teamStatsService.calculateAndWriteRankings(
        changeEvent.tournamentId,
        changeEvent.stageId
      );

      this.logger.log(
        `Ranking recalculation completed for tournament ${changeEvent.tournamentId}, ` +
        `stage ${changeEvent.stageId}`
      );
    } catch (error) {
      this.logger.error(
        `Error during ranking recalculation for tournament ${changeEvent.tournamentId}:`,
        error
      );
    }
  }

  /**
   * Trigger playoff bracket advancement when a playoff match is completed
   */
  private async triggerPlayoffBracketUpdate(changeEvent: MatchChangeEvent): Promise<void> {
    try {
      // Get stage information to check if it's a playoff stage
      const stage = await this.prisma.stage.findUnique({
        where: { id: changeEvent.stageId },
        select: { type: true }
      });

      if (!stage || stage.type !== StageType.PLAYOFF) {
        return; // Not a playoff stage, nothing to do
      }

      this.logger.log(
        `Triggering playoff bracket update for match ${changeEvent.matchId} in stage ${changeEvent.stageId}`
      );

      // Update playoff brackets - this will advance winning teams to the next round
      await this.matchSchedulerService.updatePlayoffBrackets(changeEvent.matchId);

      this.logger.log(
        `Playoff bracket update completed for match ${changeEvent.matchId}`
      );
    } catch (error) {
      this.logger.error(
        `Error during playoff bracket update for match ${changeEvent.matchId}:`,
        error
      );
    }
  }

  /**
   * Get recent changes for a tournament/stage
   */
  getRecentChanges(tournamentId: string, stageId?: string): MatchChangeEvent[] {
    const changes = Array.from(this.recentChanges.values()).filter(change => {
      if (change.tournamentId !== tournamentId) return false;
      if (stageId && change.stageId !== stageId) return false;
      return true;
    });

    return changes.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Check if there have been recent match completions
   */
  hasRecentCompletions(tournamentId: string, stageId?: string, since?: Date): boolean {
    const sinceTime = since || new Date(Date.now() - 5 * 60 * 1000); // Default: last 5 minutes

    return Array.from(this.recentChanges.values()).some(change => {
      if (change.tournamentId !== tournamentId) return false;
      if (stageId && change.stageId !== stageId) return false;
      if (change.timestamp < sinceTime) return false;
      return change.newStatus === MatchState.COMPLETED;
    });
  }

  /**
   * Get the timestamp of the last ranking-affecting change
   */
  getLastRankingChangeTime(tournamentId: string, stageId?: string): Date | null {
    const relevantChanges = this.getRecentChanges(tournamentId, stageId).filter(
      change => change.newStatus === MatchState.COMPLETED
    );

    if (relevantChanges.length === 0) return null;

    return relevantChanges[0].timestamp;
  }

  /**
   * Clean up old change records
   */
  private cleanupOldChanges(): void {
    const cutoffTime = new Date(Date.now() - this.CHANGE_RETENTION_TIME);
    let cleanedCount = 0;

    for (const [matchId, change] of this.recentChanges.entries()) {
      if (change.timestamp < cutoffTime) {
        this.recentChanges.delete(matchId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} old match change records`);
    }
  }

  /**
   * Force ranking recalculation for a tournament/stage
   */
  async forceRankingRecalculation(tournamentId: string, stageId?: string): Promise<void> {
    try {
      // Check if stage is Swiss before recalculating rankings
      if (stageId) {
        const stage = await this.prisma.stage.findUnique({
          where: { id: stageId },
          select: { type: true }
        });

        if (!stage || stage.type !== StageType.SWISS) {
          throw new Error(`Ranking recalculation is only available for Swiss stages, not ${stage?.type || 'unknown'} stages`);
        }
      }

      this.logger.log(
        `Force recalculating rankings for tournament ${tournamentId}` +
        (stageId ? `, stage ${stageId}` : '')
      );

      await this.teamStatsService.calculateAndWriteRankings(tournamentId, stageId);

      this.logger.log(
        `Force ranking recalculation completed for tournament ${tournamentId}` +
        (stageId ? `, stage ${stageId}` : '')
      );
    } catch (error) {
      this.logger.error(
        `Error during force ranking recalculation for tournament ${tournamentId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get statistics about recent match activity
   */
  getActivityStats(tournamentId: string, stageId?: string): {
    totalChanges: number;
    recentCompletions: number;
    lastChangeTime: Date | null;
    affectedTeams: Set<string>;
  } {
    const changes = this.getRecentChanges(tournamentId, stageId);
    const recentCompletions = changes.filter(
      change => change.newStatus === MatchState.COMPLETED
    ).length;

    const affectedTeams = new Set<string>();
    changes.forEach(change => {
      change.affectedTeamIds.forEach(teamId => affectedTeams.add(teamId));
    });

    return {
      totalChanges: changes.length,
      recentCompletions,
      lastChangeTime: changes.length > 0 ? changes[0].timestamp : null,
      affectedTeams,
    };
  }
}
