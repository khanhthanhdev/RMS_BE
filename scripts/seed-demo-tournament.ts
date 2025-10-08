import {
  AllianceColor,
  MatchState,
  StageStatus,
  StageType,
  UserRole,
} from '../generated/prisma';
import { PrismaService } from '../src/prisma.service';
import { PlayoffScheduler } from '../src/match-scheduler/playoff-scheduler';
import { SwissScheduler } from '../src/match-scheduler/swiss-scheduler';

const prisma = new PrismaService();

const ADMIN_USERNAME = 'demo.tournament.admin';
const TOURNAMENT_ID = 'demo-tournament-8-teams';
const QUALIFICATION_STAGE_ID = 'demo-qualification-stage';
const PLAYOFF_STAGE_ID = 'demo-playoff-stage';
const FINAL_STAGE_ID = 'demo-final-stage';

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60 * 1000);
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

const TEAM_CONFIG = [
  { id: 'demo-team-1', number: 'DEMO-101', name: 'Demo Robotics Alpha' },
  { id: 'demo-team-2', number: 'DEMO-102', name: 'Demo Robotics Beta' },
  { id: 'demo-team-3', number: 'DEMO-103', name: 'Demo Robotics Gamma' },
  { id: 'demo-team-4', number: 'DEMO-104', name: 'Demo Robotics Delta' },
  { id: 'demo-team-5', number: 'DEMO-105', name: 'Demo Robotics Echo' },
  { id: 'demo-team-6', number: 'DEMO-106', name: 'Demo Robotics Foxtrot' },
  { id: 'demo-team-7', number: 'DEMO-107', name: 'Demo Robotics Golf' },
  { id: 'demo-team-8', number: 'DEMO-108', name: 'Demo Robotics Hotel' },
];

const formatSeedPhone = (value: number) =>
  `09${value.toString().padStart(8, '0')}`;

async function ensureAdmin() {
  const now = new Date();
  return prisma.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {
      name: 'Demo Tournament Admin',
      email: 'demo-admin@example.com',
      phoneNumber: formatSeedPhone(0),
      updatedAt: now,
    },
    create: {
      username: ADMIN_USERNAME,
      password: 'demo-password',
      role: UserRole.ADMIN,
      name: 'Demo Tournament Admin',
      email: 'demo-admin@example.com',
      phoneNumber: formatSeedPhone(0),
      gender: 'OTHER',
      isActive: true,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function createDemoTeams(tournamentId: string) {
  const teams: any[] = [];

  for (const config of TEAM_CONFIG) {
    const ownerIndex = parseInt(config.id.split('-').pop() || '0', 10);
    const owner = await prisma.user.upsert({
      where: { username: `${config.id}-owner` },
      update: {
        email: `${config.id}@example.com`,
        phoneNumber: formatSeedPhone(ownerIndex),
      },
      create: {
        username: `${config.id}-owner`,
        password: 'demo-password',
        role: UserRole.TEAM_LEADER,
        name: `${config.name} Owner`,
        email: `${config.id}@example.com`,
        phoneNumber: formatSeedPhone(ownerIndex),
        gender: 'OTHER',
        isActive: true,
        emailVerified: true,
      },
    });

    const team = await prisma.team.upsert({
      where: { id: config.id },
      update: {
        teamNumber: config.number,
        name: config.name,
        tournamentId,
        userId: owner.id,
        referralSource: 'demo-tournament-seed',
      },
      create: {
        id: config.id,
        teamNumber: config.number,
        name: config.name,
        tournamentId,
        userId: owner.id,
        referralSource: 'demo-tournament-seed',
      },
    });

    teams.push(team);
  }

  return teams;
}

async function createDemoTournament(adminId: string) {
  const now = new Date();

  // Create tournament with 2 fields
  const tournament = await prisma.tournament.upsert({
    where: { id: TOURNAMENT_ID },
    update: {
      name: 'Demo Robotics Tournament - 8 Teams',
      description: 'Complete demo tournament with qualification, playoff, and final stages for testing match generation and display',
      startDate: now,
      endDate: addHours(now, 24), // 24 hours tournament
      adminId,
      numberOfFields: 2, // 2 fields for parallel matches
      maxTeams: 8,
      maxTeamMembers: 5,
      minTeamMembers: 1,
    },
    create: {
      id: TOURNAMENT_ID,
      name: 'Demo Robotics Tournament - 8 Teams',
      description: 'Complete demo tournament with qualification, playoff, and final stages for testing match generation and display',
      startDate: now,
      endDate: addHours(now, 24), // 24 hours tournament
      adminId,
      numberOfFields: 2, // 2 fields for parallel matches
      maxTeams: 8,
      maxTeamMembers: 5,
      minTeamMembers: 1,
    },
  });

  // Create fields for the tournament
  for (let n = 1; n <= 2; n++) {
    await prisma.field.upsert({
      where: {
        tournamentId_number: {
          tournamentId: tournament.id,
          number: n,
        },
      },
      update: {
        name: `Field ${n}`,
      },
      create: {
        tournamentId: tournament.id,
        number: n,
        name: `Field ${n}`,
      },
    });
  }

  console.log(`Created tournament: ${tournament.name} (${tournament.id}) with 2 fields`);
  return tournament;
}

async function createQualificationStage(tournamentId: string, teamIds: string[]) {
  const now = new Date();

  const stage = await prisma.stage.upsert({
    where: { id: QUALIFICATION_STAGE_ID },
    update: {
      name: 'Qualification Round',
      description: 'Round-robin qualification matches to determine playoff seeding',
      type: StageType.SWISS, // Use SWISS for round-robin style
      status: StageStatus.ACTIVE,
      startDate: now,
      endDate: addHours(now, 8),
      tournamentId,
      teamsPerAlliance: 2,
      maxTeams: 8,
      isElimination: false,
      teams: {
        set: teamIds.map(id => ({ id })),
      },
    },
    create: {
      id: QUALIFICATION_STAGE_ID,
      name: 'Qualification Round',
      description: 'Round-robin qualification matches to determine playoff seeding',
      type: StageType.SWISS, // Use SWISS for round-robin style
      status: StageStatus.ACTIVE,
      startDate: now,
      endDate: addHours(now, 8),
      tournamentId,
      teamsPerAlliance: 2,
      maxTeams: 8,
      isElimination: false,
      teams: {
        connect: teamIds.map(id => ({ id })),
      },
    },
  });

  console.log(`Created qualification stage: ${stage.name} (${stage.id})`);
  return stage;
}

async function createPlayoffStage(tournamentId: string) {
  const now = new Date();
  const startTime = addHours(now, 9); // Start after qualification

  const stage = await prisma.stage.upsert({
    where: { id: PLAYOFF_STAGE_ID },
    update: {
      name: 'Playoff Bracket',
      description: 'Single-elimination playoff bracket for top teams',
      type: StageType.PLAYOFF,
      status: StageStatus.ACTIVE, // Keep active but will be managed by advancement logic
      startDate: startTime,
      endDate: addHours(startTime, 12),
      tournamentId,
      teamsPerAlliance: 2,
      maxTeams: 8,
      isElimination: true,
      advancementRules: 'Top 4 teams from qualification advance to playoffs',
    },
    create: {
      id: PLAYOFF_STAGE_ID,
      name: 'Playoff Bracket',
      description: 'Single-elimination playoff bracket for top teams',
      type: StageType.PLAYOFF,
      status: StageStatus.ACTIVE,
      startDate: startTime,
      endDate: addHours(startTime, 12),
      tournamentId,
      teamsPerAlliance: 2,
      maxTeams: 8,
      isElimination: true,
      advancementRules: 'Top 4 teams from qualification advance to playoffs',
    },
  });

  console.log(`Created playoff stage: ${stage.name} (${stage.id})`);
  return stage;
}

async function createFinalStage(tournamentId: string) {
  const now = new Date();
  const startTime = addHours(now, 22); // Start near the end of tournament

  const stage = await prisma.stage.upsert({
    where: { id: FINAL_STAGE_ID },
    update: {
      name: 'Championship Final',
      description: 'Final championship match between playoff winners',
      type: StageType.FINAL,
      status: StageStatus.ACTIVE,
      startDate: startTime,
      endDate: addHours(startTime, 2),
      tournamentId,
      teamsPerAlliance: 2,
      maxTeams: 4, // Only 2 alliances needed
      isElimination: true,
      advancementRules: 'Playoff bracket winners advance to final',
    },
    create: {
      id: FINAL_STAGE_ID,
      name: 'Championship Final',
      description: 'Final championship match between playoff winners',
      type: StageType.FINAL,
      status: StageStatus.ACTIVE,
      startDate: startTime,
      endDate: addHours(startTime, 2),
      tournamentId,
      teamsPerAlliance: 2,
      maxTeams: 4,
      isElimination: true,
      advancementRules: 'Playoff bracket winners advance to final',
    },
  });

  console.log(`Created final stage: ${stage.name} (${stage.id})`);
  return stage;
}

async function generateQualificationMatches(stageId: string, teamIds: string[], tournamentId: string) {
  console.log('Generating qualification matches...');

  // Get available fields for this tournament
  const fields = await prisma.field.findMany({
    where: { tournamentId },
    orderBy: { number: 'asc' },
  });

  if (fields.length === 0) {
    throw new Error('No fields available for match assignment');
  }

  console.log(`Found ${fields.length} fields for match assignment`);

  // Create round-robin matches for 8 teams
  // Each team plays 3 matches (simple round-robin for demo)
  const matches: any[] = [];
  const now = new Date();
  let matchNumber = 1;

  // Simple round-robin: create 12 matches (each team plays 3 matches)
  const matchups = [
    [0, 1], [2, 3], [4, 5], [6, 7], // Round 1
    [0, 2], [1, 3], [4, 6], [5, 7], // Round 2
    [0, 3], [1, 2], [4, 7], [5, 6], // Round 3
  ];

  for (let round = 0; round < matchups.length; round++) {
    const [team1Idx, team2Idx] = matchups[round];
    const scheduledTime = addMinutes(now, (round + 1) * 30); // 30 min intervals
    
    // Assign field in round-robin fashion
    const fieldIndex = round % fields.length;
    const assignedField = fields[fieldIndex];

    const match = await prisma.match.create({
      data: {
        stageId,
        matchNumber,
        roundNumber: Math.floor(round / 4) + 1,
        status: MatchState.PENDING,
        scheduledTime,
        duration: 5, // 5 minutes per match
        matchType: 'FULL',
        fieldId: assignedField.id,
        alliances: {
          create: [
            {
              color: AllianceColor.RED,
              teamAlliances: {
                create: [
                  { teamId: teamIds[team1Idx], stationPosition: 1 },
                ],
              },
            },
            {
              color: AllianceColor.BLUE,
              teamAlliances: {
                create: [
                  { teamId: teamIds[team2Idx], stationPosition: 1 },
                ],
              },
            },
          ],
        },
      },
      include: {
        alliances: {
          include: {
            teamAlliances: { include: { team: true } },
          },
        },
      },
    });

    matches.push(match);
    matchNumber++;
  }

  console.log(`Generated ${matches.length} qualification matches`);
  return matches;
}

async function generatePlayoffMatches(stageId: string, tournamentId: string) {
  console.log('Generating playoff matches...');

  // Get available fields for this tournament
  const fields = await prisma.field.findMany({
    where: { tournamentId },
    orderBy: { number: 'asc' },
  });

  if (fields.length === 0) {
    throw new Error('No fields available for playoff match assignment');
  }

  // Get tournament with teams for playoff scheduling
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: { teams: true },
  });

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    include: { tournament: { include: { teams: true } } },
  });

  if (!stage) {
    throw new Error('Stage not found');
  }

  // Create mock team stats for playoff seeding (top 4 teams)
  const topTeamIds = tournament.teams.slice(0, 4).map(t => t.id);

  for (let i = 0; i < topTeamIds.length; i++) {
    await prisma.teamStats.upsert({
      where: {
        teamId_tournamentId: {
          teamId: topTeamIds[i],
          tournamentId,
        },
      },
      update: {
        stageId,
        wins: 4 - i, // Team 0 has 4 wins, Team 1 has 3, etc.
        losses: i,
        rankingPoints: (4 - i) * 2,
        matchesPlayed: 4,
        pointDifferential: (4 - i) * 10 - i * 8,
      },
      create: {
        teamId: topTeamIds[i],
        tournamentId,
        stageId,
        wins: 4 - i,
        losses: i,
        rankingPoints: (4 - i) * 2,
        matchesPlayed: 4,
        pointDifferential: (4 - i) * 10 - i * 8,
      },
    });
  }

  // Use playoff scheduler to generate bracket
  const scheduler = new PlayoffScheduler(prisma);
  const matches = await scheduler.generatePlayoffSchedule(stage, 2); // 2 rounds for 4 teams

  console.log(`Generated ${matches.length} playoff matches`);
  return matches;
}

async function generateFinalMatch(stageId: string, tournamentId: string) {
  console.log('Generating final match...');

  // Get available fields for this tournament
  const fields = await prisma.field.findMany({
    where: { tournamentId },
    orderBy: { number: 'asc' },
  });

  if (fields.length === 0) {
    throw new Error('No fields available for final match assignment');
  }

  // Use the first field for the final match
  const finalField = fields[0];

  const now = new Date();
  const scheduledTime = addHours(now, 22);

  const match = await prisma.match.create({
    data: {
      stageId,
      matchNumber: 1,
      roundNumber: 1,
      status: MatchState.PENDING,
      scheduledTime,
      duration: 10, // Longer final match
      matchType: 'FULL',
      bracketSlot: 1,
      fieldId: finalField.id,
      alliances: {
        create: [
          {
            color: AllianceColor.RED,
            teamAlliances: {
              create: [],
            },
          },
          {
            color: AllianceColor.BLUE,
            teamAlliances: {
              create: [],
            },
          },
        ],
      },
    },
    include: {
      alliances: {
        include: {
          teamAlliances: { include: { team: true } },
        },
      },
    },
  });

  console.log(`Generated final match: ${match.id}`);
  return match;
}

async function createDemoTournamentWithMatches() {
  await prisma.onModuleInit();

  console.log('Starting demo tournament creation...');

  // Clean up existing demo data first
  console.log('Cleaning up existing demo data...');
  await prisma.match.deleteMany({
    where: {
      stageId: { in: [QUALIFICATION_STAGE_ID, PLAYOFF_STAGE_ID, FINAL_STAGE_ID] }
    }
  });
  await prisma.stage.deleteMany({
    where: { id: { in: [QUALIFICATION_STAGE_ID, PLAYOFF_STAGE_ID, FINAL_STAGE_ID] } }
  });
  await prisma.teamStats.deleteMany({
    where: { tournamentId: TOURNAMENT_ID }
  });
  await prisma.team.deleteMany({
    where: { tournamentId: TOURNAMENT_ID }
  });
  await prisma.field.deleteMany({
    where: { tournamentId: TOURNAMENT_ID }
  });
  await prisma.tournament.deleteMany({
    where: { id: TOURNAMENT_ID }
  });

  // Clean up demo users
  await prisma.user.deleteMany({
    where: {
      username: {
        in: [
          ADMIN_USERNAME,
          ...TEAM_CONFIG.map(config => `${config.id}-owner`)
        ]
      }
    }
  });

  console.log('Cleanup completed.');

  // Create admin
  const admin = await ensureAdmin();
  console.log(`Admin ready: ${admin.username}`);

  // Create tournament (this also creates fields automatically)
  const tournament = await createDemoTournament(admin.id);

  // Create teams
  const teams = await createDemoTeams(tournament.id);
  console.log(`Created ${teams.length} demo teams`);

  // Create stages
  const qualificationStage = await createQualificationStage(tournament.id, teams.map(t => t.id));
  const playoffStage = await createPlayoffStage(tournament.id);
  const finalStage = await createFinalStage(tournament.id);

  // Generate matches for each stage
  const qualificationMatches = await generateQualificationMatches(qualificationStage.id, teams.map(t => t.id), tournament.id);
  const playoffMatches = await generatePlayoffMatches(playoffStage.id, tournament.id);
  const finalMatch = await generateFinalMatch(finalStage.id, tournament.id);

  // Summary
  console.log('\n=== Demo Tournament Created Successfully ===');
  console.log(`Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`Fields: ${tournament.numberOfFields}`);
  console.log(`Teams: ${teams.length}`);
  console.log(`Stages: Qualification, Playoff, Final`);
  console.log(`Qualification Matches: ${qualificationMatches.length}`);
  console.log(`Playoff Matches: ${playoffMatches.length}`);
  console.log(`Final Matches: 1`);
  console.log('\n=== Next Steps ===');
  console.log('1. Start the backend server: npm run start:dev');
  console.log('2. Start the frontend: cd ../RMS_FE && npm run dev');
  console.log('3. Navigate to the tournament in the frontend');
  console.log('4. Test match progression through stages');
}

createDemoTournamentWithMatches()
  .catch((error) => {
    console.error('Failed to create demo tournament:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
