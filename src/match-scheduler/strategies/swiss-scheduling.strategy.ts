import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ISchedulingStrategy, SwissSchedulingOptions } from '../interfaces/scheduling-strategy.interface';
import { Match, Stage, Team, StageType, MatchState, AllianceColor } from '../../utils/prisma-types';
import { FieldAssignmentService } from '../services/field-assignment.service';
import { MatchupHistoryService } from '../services/matchup-history.service';
import { SwissScheduler } from '../swiss-scheduler';

/**
 * Swiss tournament scheduling strategy
 * Implements the Strategy pattern for Swiss-style tournaments
 */
@Injectable()
export class SwissSchedulingStrategy implements ISchedulingStrategy {
  private readonly DEFAULT_TEAMS_PER_ALLIANCE = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldAssignmentService: FieldAssignmentService,
    private readonly matchupHistoryService: MatchupHistoryService,
    private readonly swissScheduler: SwissScheduler
  ) {}

  canHandle(stage: Stage): boolean {
    return stage.type === StageType.SWISS;
  }

  getStrategyType(): string {
    return 'SWISS';
  }

  async generateMatches(
    stage: Stage & { tournament: any; teams: Team[] },
    options: SwissSchedulingOptions
  ): Promise<Match[]> {
    const { currentRoundNumber, teamsPerAlliance = this.DEFAULT_TEAMS_PER_ALLIANCE } = options;
    const teamsPerMatch = teamsPerAlliance * 2; // 2 alliances per match

    // Validate that we support this alliance size
    if (teamsPerAlliance < 1 || teamsPerAlliance > 3) {
      throw new Error(`Swiss strategy supports 1-3 teams per alliance, got ${teamsPerAlliance}`);
    }

    // Validate fields
    this.fieldAssignmentService.validateFieldAvailability(stage.tournament.fields);
    
    // Initialize field assignment tracking
    const shuffledFields = this.fieldAssignmentService.shuffleFields(stage.tournament.fields);
    let fieldAssignmentCounts = this.fieldAssignmentService.initializeFieldCounts(shuffledFields);    // Get team rankings
    const teamStats = await this.getOrCreateTeamStats(stage.id);
    
    // Get previous matchup history
    const previousOpponents = await this.matchupHistoryService.getPreviousOpponents(stage.id);
    
    // Generate matches using closest performance pairing
    const matches = await this.generateSwissMatches(
      stage.id,
      currentRoundNumber + 1,
      teamStats,
      previousOpponents,
      shuffledFields,
      fieldAssignmentCounts,
      teamsPerAlliance,
      teamsPerMatch
    );

    return matches;
  }

  /**
   * Gets team stats or creates them if they don't exist
   */
  private async getOrCreateTeamStats(stageId: string) {
    let teamStats = await this.swissScheduler.getSwissRankings(stageId);
    
    if (teamStats.length === 0) {
      console.log(`No team stats found, creating initial stats for all teams`);
      await this.swissScheduler.updateSwissRankings(stageId);
      teamStats = await this.swissScheduler.getSwissRankings(stageId);
    }
    
    console.log(`Found ${teamStats.length} teams for Swiss round generation`);
    return teamStats;
  }

  /**
   * Groups teams by their win-loss record
   */
  private groupTeamsByRecord(teamStats: any[]): Map<string, any[]> {
    const recordGroups = new Map<string, any[]>();
    
    for (const teamStat of teamStats) {
      const record = `${teamStat.wins}-${teamStat.losses}-${teamStat.ties}`;
      if (!recordGroups.has(record)) {
        recordGroups.set(record, []);
      }
      recordGroups.get(record)!.push(teamStat);
    }
    
    console.log(`Teams grouped by record:`, 
      Array.from(recordGroups.entries()).map(([record, teams]) => 
        `${record}: ${teams.length} teams`
      ).join(', ')
    );
    
    return recordGroups;
  }  /**
   * Generates Swiss matches using closest performance pairing
   */
  private async generateSwissMatches(
    stageId: string,
    nextRoundNumber: number,
    teamStats: any[],
    previousOpponents: Map<string, Set<string>>,
    shuffledFields: any[],
    initialFieldCounts: number[],
    teamsPerAlliance: number,
    teamsPerMatch: number
  ): Promise<Match[]> {
    const matches: Match[] = [];
    const paired = new Set<string>();
    
    // Get the highest match number already used in this stage
    const existingMatches = await this.prisma.match.findMany({
      where: { stageId },
      select: { matchNumber: true },
      orderBy: { matchNumber: 'desc' },
      take: 1
    });
    
    let matchNumber = existingMatches.length > 0 ? existingMatches[0].matchNumber + 1 : 1;
    let fieldAssignmentCounts = [...initialFieldCounts];

    // Sort teams by performance (best to worst)
    const sortedTeams = this.sortTeamsByTiebreakers(teamStats);
    
    console.log(`\nGenerating Swiss matches with closest performance pairing for ${sortedTeams.length} teams`);

    // Create matches by pairing teams with closest performance
    for (let i = 0; i < sortedTeams.length; i += teamsPerMatch) {
      if (i + teamsPerMatch > sortedTeams.length) {
        console.log(`Not enough teams for complete match, skipping remaining ${sortedTeams.length - i} teams`);
        break;
      }
        // Get teams with closest performance that haven't been paired yet
      const availableTeams = sortedTeams.filter(team => !paired.has(team.teamId));
      
      if (availableTeams.length < teamsPerMatch) {
        console.log(`Only ${availableTeams.length} unpaired teams remaining, stopping match generation`);
        break;
      }
      
      const matchTeams = availableTeams.slice(0, teamsPerMatch);
      
      // Optimize alliance assignment to minimize repeat matchups
      const [redTeams, blueTeams] = this.matchupHistoryService.optimizeAllianceAssignment(
        matchTeams, 
        previousOpponents,
        teamsPerAlliance
      );
      
      // Mark teams as paired
      matchTeams.forEach(team => paired.add(team.teamId));
      
      // Assign field
      const { field, updatedCounts } = this.fieldAssignmentService.assignField(
        shuffledFields, 
        fieldAssignmentCounts
      );
      fieldAssignmentCounts = updatedCounts;
      
      // Create match
      const dbMatch = await this.createSwissMatch(
        stageId,
        matchNumber++,
        nextRoundNumber,
        redTeams,
        blueTeams,
        field
      );
      
      matches.push(dbMatch);
      
      console.log(`Created match ${matchNumber - 1}: [${redTeams.map(t => t.team.teamNumber).join(',')}] vs [${blueTeams.map(t => t.team.teamNumber).join(',')}] on ${field.name}`);
    }

    console.log(`\nGenerated ${matches.length} Swiss matches for round ${nextRoundNumber}`);
    return matches;
  }
  /**
   * Sorts teams by tiebreakers
   */
  private sortTeamsByTiebreakers(teams: any[]): any[] {
    return [...teams].sort((a, b) => {
      if (b.rankingPoints !== a.rankingPoints) return b.rankingPoints - a.rankingPoints;
      if (Math.abs(b.opponentWinPercentage - a.opponentWinPercentage) > 0.001) 
        return b.opponentWinPercentage - a.opponentWinPercentage;
      return b.pointDifferential - a.pointDifferential;
    });
  }

  /**
   * Creates a Swiss match in the database
   */
  private async createSwissMatch(
    stageId: string,
    matchNumber: number,
    roundNumber: number,
    redTeams: any[],
    blueTeams: any[],
    field: any
  ): Promise<Match> {
    // Calculate scheduled time based on field number and match order
    // Default: 5-minute intervals between fields, 10-minute intervals between rounds
    const fieldNumber = field.number || 1;
    const baseTime = Date.now();
    const fieldOffset = (fieldNumber - 1) * 5 * 60 * 1000; // 5 minutes per field
    const roundOffset = (roundNumber - 1) * 10 * 60 * 1000; // 10 minutes per round
    const scheduledTime = new Date(baseTime + fieldOffset + roundOffset);

    return await this.prisma.match.create({
      data: {
        stageId,
        matchNumber,
        roundNumber,
        scheduledTime,
        status: MatchState.PENDING,
        fieldId: field.id,
        alliances: {
          create: [
            {
              color: AllianceColor.RED,
              teamAlliances: {
                create: redTeams.map((team, idx) => ({
                  teamId: team.teamId,
                  stationPosition: idx + 1
                }))
              }
            },
            {
              color: AllianceColor.BLUE,
              teamAlliances: {
                create: blueTeams.map((team, idx) => ({
                  teamId: team.teamId,
                  stationPosition: idx + 1
                }))
              }
            }
          ]
        }
      },
      include: {
        alliances: {
          include: {
            teamAlliances: {
              include: {
                team: true
              }
            }
          }
        }
      }
    }) as Match;
  }
}
