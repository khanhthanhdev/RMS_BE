import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Match as PrismaMatch, StageType, AllianceColor, MatchState } from '../utils/prisma-types';
/**
 * Playoff bracket generation and advancement logic.
 * Extracted from MatchSchedulerService for separation of concerns.
 */
@Injectable()
export class PlayoffScheduler {
  constructor(private readonly prisma: PrismaService) { }

  async generatePlayoffSchedule(stage: any, numberOfRounds: number): Promise<PrismaMatch[]> {
    if (stage.type !== StageType.PLAYOFF) {
      throw new Error(`Stage with ID ${stage.id} is not a PLAYOFF stage`);
    }

    const numTeamsNeeded = Math.pow(2, numberOfRounds);
    const teamStats = await this.prisma.teamStats.findMany({
      where: { tournamentId: stage.tournament.id },
      include: { team: true },
      orderBy: [
        { wins: 'desc' },
        { tiebreaker1: 'desc' },
        { tiebreaker2: 'desc' }
      ]
    });

    if (teamStats.length < numTeamsNeeded) {
      throw new Error(`Not enough teams with stats for a ${numberOfRounds}-round playoff. Need ${numTeamsNeeded} teams, got ${teamStats.length}`);
    }

    const lastMatchNumber = await this.prisma.match.findFirst({
      where: { stageId: stage.id },
      orderBy: { matchNumber: 'desc' },
      select: { matchNumber: true }
    });

    const lastBracketSlot = await this.prisma.match.findFirst({
      where: { stageId: stage.id },
      orderBy: { bracketSlot: 'desc' },
      select: { bracketSlot: true }
    });

    let nextMatchNumber = lastMatchNumber?.matchNumber ? lastMatchNumber.matchNumber + 1 : 1;
    let nextBracketSlot = lastBracketSlot?.bracketSlot ? lastBracketSlot.bracketSlot + 1 : 1;
    const matchesByRound: Record<number, PrismaMatch[]> = {};
    const createdMatches: PrismaMatch[] = [];
    const kickoffTime = Date.now();
    const slotDurationMinutes = 15;

    for (let round = 1; round <= numberOfRounds; round++) {
      const matchesInRound = Math.pow(2, numberOfRounds - round);
      matchesByRound[round] = [];

      for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex++) {
        const scheduledOffsetMinutes = (createdMatches.length + 1) * slotDurationMinutes;
        const allianceCreate = round === 1
          ? this.createSeededAlliancePayload(teamStats, matchIndex, numTeamsNeeded)
          : this.createEmptyAlliancePayload(stage.teamsPerAlliance || 2);

        const match = await this.prisma.match.create({
          data: {
            stageId: stage.id,
            matchNumber: nextMatchNumber++,
            roundNumber: round,
            status: MatchState.PENDING,
            scheduledTime: new Date(kickoffTime + scheduledOffsetMinutes * 60 * 1000),
            bracketSlot: nextBracketSlot,
            alliances: allianceCreate
          },
          include: {
            alliances: {
              include: {
                teamAlliances: { include: { team: true } }
              }
            }
          }
        });

        matchesByRound[round].push(match as PrismaMatch);
        createdMatches.push(match as PrismaMatch);
        nextBracketSlot++;
      }

      if (round > 1) {
        const previousRoundMatches = matchesByRound[round - 1];
        const currentRoundMatches = matchesByRound[round];

        await Promise.all(previousRoundMatches.map(async (previousMatch, index) => {
          const targetMatch = currentRoundMatches[Math.floor(index / 2)];
          const updated = await this.prisma.match.update({
            where: { id: previousMatch.id },
            data: {
              feedsIntoMatchId: targetMatch.id
            }
          });

          previousRoundMatches[index] = {
            ...previousMatch,
            feedsIntoMatchId: updated.feedsIntoMatchId
          } as PrismaMatch;
        }));
      }
    }

    const matchIds = createdMatches.map(match => match.id);
    return this.prisma.match.findMany({
      where: { id: { in: matchIds } },
      include: {
        alliances: {
          include: {
            teamAlliances: { include: { team: true } }
          }
        },
        feedsIntoMatch: true
      }
    });
  }

  private createSeededAlliancePayload(teamStats: any[], matchIndex: number, numTeamsNeeded: number) {
    const highSeedIdx = matchIndex;
    const lowSeedIdx = numTeamsNeeded - 1 - matchIndex;
    const highSeed = teamStats[highSeedIdx];
    const lowSeed = teamStats[lowSeedIdx];

    if (!highSeed || !lowSeed) {
      throw new Error(`Unable to determine playoff seeds for match index ${matchIndex}`);
    }

    return {
      create: [
        {
          color: AllianceColor.RED,
          teamAlliances: {
            create: [{ teamId: highSeed.teamId, stationPosition: 1 }]
          }
        },
        {
          color: AllianceColor.BLUE,
          teamAlliances: {
            create: [{ teamId: lowSeed.teamId, stationPosition: 1 }]
          }
        }
      ]
    };
  }

  private createEmptyAlliancePayload(_teamsPerAlliance: number) {
    return {
      create: [
        { color: AllianceColor.RED, teamAlliances: { create: [] } },
        { color: AllianceColor.BLUE, teamAlliances: { create: [] } }
      ]
    };
  }

  async updatePlayoffBrackets(matchId: string): Promise<PrismaMatch[]> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        alliances: { include: { teamAlliances: true } },
        matchScores: true,
        feedsIntoMatch: {
          include: {
            alliances: { include: { teamAlliances: true } }
          }
        }
      }
    });
    if (!match) throw new Error(`Match with ID ${matchId} not found`);
    if (match.status !== MatchState.COMPLETED) throw new Error(`Match ${matchId} is not completed`);
    if (!match.winningAlliance) throw new Error(`Match ${matchId} has no winning alliance`);
    if (!match.feedsIntoMatchId) {
      throw new Error(`Match ${matchId} does not feed into another match`);
    }

    const winningAlliance = match.alliances.find(alliance => alliance.color === match.winningAlliance);
    if (!winningAlliance) throw new Error(`No winning alliance found for match ${matchId}`);

    const nextMatch = match.feedsIntoMatch ?? await this.prisma.match.findUnique({
      where: { id: match.feedsIntoMatchId },
      include: { alliances: { include: { teamAlliances: true } } }
    });

    if (!nextMatch) throw new Error(`Next match ${match.feedsIntoMatchId} not found`);

    const matchesInRound = await this.prisma.match.findMany({
      where: { stageId: match.stageId, roundNumber: match.roundNumber },
      select: { id: true, bracketSlot: true },
      orderBy: { bracketSlot: 'asc' }
    });

    const matchIndex = matchesInRound.findIndex(entry => entry.id === matchId);
    if (matchIndex === -1) {
      throw new Error(`Unable to determine bracket position for match ${matchId}`);
    }

    const advancesAs = matchIndex % 2 === 0 ? AllianceColor.RED : AllianceColor.BLUE;
    const targetAlliance = nextMatch.alliances.find(alliance => alliance.color === advancesAs);
    if (!targetAlliance) throw new Error(`Target alliance ${advancesAs} not found in next match`);

    await this.prisma.teamAlliance.deleteMany({ where: { allianceId: targetAlliance.id } });

    for (const teamAlliance of winningAlliance.teamAlliances) {
      await this.prisma.teamAlliance.create({
        data: {
          allianceId: targetAlliance.id,
          teamId: teamAlliance.teamId,
          stationPosition: teamAlliance.stationPosition
        }
      });
    }
    const updatedMatches = await this.prisma.match.findMany({
      where: { id: { in: [matchId, nextMatch.id] } },
      include: {
        alliances: {
          include: {
            teamAlliances: { include: { team: true } }
          }
        }
      }
    });
    return updatedMatches as any[];
  }

  async finalizePlayoffRankings(stageId: string): Promise<PrismaMatch[]> {
    const matches = await this.prisma.match.findMany({
      where: { stageId },
      include: {
        alliances: {
          include: {
            teamAlliances: { include: { team: true } }
          }
        }
      },
      orderBy: [
        { roundNumber: 'desc' },
        { matchNumber: 'asc' }
      ]
    });
    if (matches.length === 0) throw new Error(`No matches found for stage ${stageId}`);
    const incompleteMatches = matches.filter(match => match.status !== MatchState.COMPLETED);
    if (incompleteMatches.length > 0) throw new Error(`Cannot finalize rankings: ${incompleteMatches.length} matches are still incomplete`);
    const teamRankings = new Map<string, number>();
    for (const match of matches) {
      if (!match.winningAlliance) continue;
      const winningAlliance = match.alliances.find(a => a.color === match.winningAlliance);
      const losingAlliance = match.alliances.find(a => a.color !== match.winningAlliance);
      if (!winningAlliance || !losingAlliance) continue;
      const maxRound = Math.max(...matches.map(m => m.roundNumber || 0));
      if (match.roundNumber === maxRound) {
        for (const ta of winningAlliance.teamAlliances) {
          teamRankings.set(ta.teamId, 1);
        }
        for (const ta of losingAlliance.teamAlliances) {
          teamRankings.set(ta.teamId, 2);
        }
      } else {
        const roundNumber = match.roundNumber || 0;
        const baseRank = Math.pow(2, maxRound - roundNumber) + 1;
        for (const ta of losingAlliance.teamAlliances) {
          teamRankings.set(ta.teamId, baseRank);
        }
      }
    }
    for (const [teamId, rank] of teamRankings.entries()) {
      await this.prisma.teamStats.updateMany({
        where: { teamId, stageId },
        data: { rank }
      });
    }
    return matches as any[];
  }
}
