import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Match as PrismaMatch, StageType, AllianceColor, MatchState } from '../utils/prisma-types';
import { FRC_RANKING_ORDER } from '../constants/ranking.constants';
/**
 * Playoff bracket generation and advancement logic.
 * Extracted from MatchSchedulerService for separation of concerns.
 */
@Injectable()
export class PlayoffScheduler {
  private readonly logger = new Logger(PlayoffScheduler.name);

  constructor(private readonly prisma: PrismaService) { }

  async generatePlayoffSchedule(stage: any, numberOfRounds: number): Promise<PrismaMatch[]> {
    if (stage.type !== StageType.PLAYOFF) {
      throw new Error(`Stage with ID ${stage.id} is not a PLAYOFF stage`);
    }

    const teamsPerAlliance = stage.teamsPerAlliance || 1;
    const numTeamsNeeded = Math.pow(2, numberOfRounds);
    const teamStats = await this.prisma.teamStats.findMany({
      where: { tournamentId: stage.tournament.id },
      include: { team: true },
      orderBy: FRC_RANKING_ORDER
    });

    if (teamStats.length < numTeamsNeeded) {
      throw new Error(`Not enough teams with stats for a ${numberOfRounds}-round playoff. Need ${numTeamsNeeded} teams, got ${teamStats.length}`);
    }

    // Get available fields for match assignment
    const fields = await this.prisma.field.findMany({
      where: { tournamentId: stage.tournament.id },
      orderBy: { number: 'asc' },
    });

    if (fields.length === 0) {
      throw new Error('No fields available for playoff match assignment');
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
          ? this.createSeededAlliancePayload(teamStats, matchIndex, teamsPerAlliance, numTeamsNeeded)
          : this.createEmptyAlliancePayload(teamsPerAlliance);

        // Assign field in round-robin fashion
        const fieldIndex = createdMatches.length % fields.length;
        const assignedField = fields[fieldIndex];

        const match = await this.prisma.match.create({
          data: {
            stageId: stage.id,
            matchNumber: nextMatchNumber++,
            roundNumber: round,
            status: MatchState.PENDING,
            scheduledTime: new Date(kickoffTime + scheduledOffsetMinutes * 60 * 1000),
            bracketSlot: nextBracketSlot,
            fieldId: assignedField.id,
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

  private createSeededAlliancePayload(
    teamStats: any[],
    matchIndex: number,
    teamsPerAlliance: number,
    numTeamsNeeded: number
  ) {
    // For playoff seeding with 4 teams, use standard bracket seeding:
    // Match 0: 1st vs 4th, Match 1: 2nd vs 3rd
    const seedOrder = [0, 3, 1, 2]; // 1st, 4th, 2nd, 3rd
    const redSeedIndex = seedOrder[matchIndex * 2];
    const blueSeedIndex = seedOrder[matchIndex * 2 + 1];

    const redSeeds = [teamStats[redSeedIndex]];
    const blueSeeds = [teamStats[blueSeedIndex]];

    if (!redSeeds[0] || !blueSeeds[0]) {
      throw new Error(`Unable to determine playoff seeds for match index ${matchIndex}`);
    }

    return {
      create: [
        {
          color: AllianceColor.RED,
          teamAlliances: {
            create: redSeeds.map((seed: any, idx: number) => ({
              teamId: seed.teamId,
              stationPosition: idx + 1,
            }))
          }
        },
        {
          color: AllianceColor.BLUE,
          teamAlliances: {
            create: blueSeeds.map((seed: any, idx: number) => ({
              teamId: seed.teamId,
              stationPosition: idx + 1,
            }))
          }
        }
      ]
    };
  }

  private createEmptyAlliancePayload(_teamsPerAlliance: number) {
    return {
      create: [
        {
          color: AllianceColor.RED,
          teamAlliances: { create: [] }
        },
        {
          color: AllianceColor.BLUE,
          teamAlliances: { create: [] }
        }
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
        },
        stage: true
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
