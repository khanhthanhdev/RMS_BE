import { StageType, StageStatus, UserRole } from '../generated/prisma';
import { PrismaService } from '../src/prisma.service';
import { PlayoffScheduler } from '../src/match-scheduler/playoff-scheduler';
import { SwissScheduler } from '../src/match-scheduler/swiss-scheduler';

const ADMIN_USERNAME = 'demo.bracket.admin';
const PLAYOFF_TOURNAMENT_ID = 'demo-playoff-tournament';
const SWISS_TOURNAMENT_ID = 'demo-swiss-tournament';
const PLAYOFF_STAGE_ID = 'demo-playoff-stage';
const SWISS_STAGE_ID = 'demo-swiss-stage';

const prismaClient = new PrismaService();

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60 * 1000);

async function ensureAdmin() {
  const now = new Date();
  return prismaClient.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {
      name: 'Bracket Admin',
      email: 'bracket-admin@example.com',
      updatedAt: now,
    },
    create: {
      username: ADMIN_USERNAME,
      password: 'demo-password',
      role: UserRole.ADMIN,
      name: 'Bracket Admin',
      email: 'bracket-admin@example.com',
      gender: 'OTHER',
      isActive: true,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function upsertTeams(
  tournamentId: string,
  prefix: string,
  count: number,
) {
  const teams = [] as { id: string; teamId: string; ownerId: string }[];
  for (let i = 1; i <= count; i += 1) {
    const email = `${prefix}.team.${i}@example.com`;
    const phoneNumber = `+1999${prefix === 'playoff' ? '1' : '2'}${String(i).padStart(3, '0')}00`;
    const owner = await prismaClient.user.upsert({
      where: { username: `${prefix}.team.owner.${i}` },
      update: {
        email,
      },
      create: {
        username: `${prefix}.team.owner.${i}`,
        password: 'demo-password',
        role: UserRole.TEAM_LEADER,
        name: `${prefix.toUpperCase()} Team Owner ${i}`,
        email,
        gender: 'OTHER',
        isActive: true,
      },
    });

    const teamId = `${prefix}-team-${i}`;
    const teamNumber = `${prefix === 'playoff' ? 'PO' : 'SW'}-${100 + i}`;

    const team = await prismaClient.team.upsert({
      where: { id: teamId },
      update: {
        name: `${prefix.toUpperCase()} Demo Team ${i}`,
        tournamentId,
        userId: owner.id,
        referralSource: 'demo-script',
      },
      create: {
        id: teamId,
        teamNumber,
        name: `${prefix.toUpperCase()} Demo Team ${i}`,
        tournamentId,
        userId: owner.id,
        referralSource: 'demo-script',
      },
    });

    teams.push({ id: team.id, teamId: team.id, ownerId: owner.id });
  }
  return teams;
}

async function upsertTournament(
  tournamentId: string,
  name: string,
  adminId: string,
) {
  const now = new Date();
  return prismaClient.tournament.upsert({
    where: { id: tournamentId },
    update: {
      name,
      description: `${name} seeded by script`,
      startDate: now,
      endDate: addMinutes(now, 60 * 24),
      adminId,
      numberOfFields: 2,
      updatedAt: now,
    },
    create: {
      id: tournamentId,
      name,
      description: `${name} seeded by script`,
      startDate: now,
      endDate: addMinutes(now, 60 * 24),
      adminId,
      numberOfFields: 2,
    },
  });
}

async function upsertStage(
  stageId: string,
  tournamentId: string,
  type: StageType,
  teamIds: string[],
  teamsPerAlliance: number,
) {
  const now = new Date();
  await prismaClient.stage.upsert({
    where: { id: stageId },
    update: {
      name: `${type === StageType.PLAYOFF ? 'Playoff' : 'Swiss'} Demo Stage`,
      description: 'Seeded for bracket metadata validation',
      status: StageStatus.ACTIVE,
      startDate: now,
      endDate: addMinutes(now, 120),
      teamsPerAlliance,
      isElimination: type === StageType.PLAYOFF,
      teams: {
        set: teamIds.map((teamId) => ({ id: teamId })),
      },
    },
    create: {
      id: stageId,
      name: `${type === StageType.PLAYOFF ? 'Playoff' : 'Swiss'} Demo Stage`,
      description: 'Seeded for bracket metadata validation',
      type,
      status: StageStatus.ACTIVE,
      startDate: now,
      endDate: addMinutes(now, 120),
      tournamentId,
      teamsPerAlliance,
      isElimination: type === StageType.PLAYOFF,
      teams: {
        connect: teamIds.map((teamId) => ({ id: teamId })),
      },
    },
  });
}

async function seedTeamStats(
  tournamentId: string,
  stageId: string,
  teamIds: string[],
) {
  const baseWins = teamIds.length;
  let seed = 0;
  for (const teamId of teamIds) {
    const wins = baseWins - seed;
    await prismaClient.teamStats.upsert({
      where: {
        teamId_tournamentId: {
          teamId,
          tournamentId,
        },
      },
      update: {
        stageId,
        wins,
        losses: seed,
        rankingPoints: wins * 2,
        matchesPlayed: wins + seed,
        pointDifferential: wins * 10 - seed * 8,
      },
      create: {
        teamId,
        tournamentId,
        stageId,
        wins,
        losses: seed,
        rankingPoints: wins * 2,
        matchesPlayed: wins + seed,
        pointDifferential: wins * 10 - seed * 8,
      },
    });
    seed += 1;
  }
}

async function seedPlayoffBracket(adminId: string) {
  const tournament = await upsertTournament(
    PLAYOFF_TOURNAMENT_ID,
    'Demo Playoff Bracket (16 Teams)',
    adminId,
  );
  const teams = await upsertTeams(tournament.id, 'playoff', 16);
  await upsertStage(
    PLAYOFF_STAGE_ID,
    tournament.id,
    StageType.PLAYOFF,
    teams.map((team) => team.teamId),
    1,
  );
  await seedTeamStats(
    tournament.id,
    PLAYOFF_STAGE_ID,
    teams.map((team) => team.teamId),
  );

  const stage = await prismaClient.stage.findUnique({
    where: { id: PLAYOFF_STAGE_ID },
    include: {
      tournament: { include: { teams: true } },
      teams: true,
    },
  });

  if (!stage) {
    throw new Error('Failed to load playoff stage');
  }

  const scheduler = new PlayoffScheduler(prismaClient);
  const matches = await scheduler.generatePlayoffSchedule(stage, 4); // 4 rounds for 16 teams
  return matches;
}

async function seedSwissBracket(adminId: string) {
  const tournament = await upsertTournament(
    SWISS_TOURNAMENT_ID,
    'Demo Swiss Bracket (16 Teams)',
    adminId,
  );
  const teams = await upsertTeams(tournament.id, 'swiss', 16);
  await upsertStage(
    SWISS_STAGE_ID,
    tournament.id,
    StageType.SWISS,
    teams.map((team) => team.teamId),
    2,
  );

  const scheduler = new SwissScheduler(prismaClient);
  const matches = await scheduler.generateSwissRound(SWISS_STAGE_ID, 0);
  return matches;
}

async function logBracketSummary(stageId: string) {
  const matches = await prismaClient.match.findMany({
    where: { stageId },
    orderBy: [
      { roundNumber: 'asc' },
      { bracketSlot: 'asc' },
    ],
    include: {
      feedsIntoMatch: {
        select: { id: true, matchNumber: true },
      },
    },
  });

  return matches.map((match) => ({
    id: match.id,
    matchNumber: match.matchNumber,
    roundNumber: match.roundNumber,
    bracketSlot: match.bracketSlot,
    recordBucket: match.recordBucket,
    feedsIntoMatchId: match.feedsIntoMatchId,
    feedsIntoMatchNumber: match.feedsIntoMatch?.matchNumber ?? null,
  }));
}

async function main() {
  await prismaClient.onModuleInit();
  const admin = await ensureAdmin();
  await prismaClient.match.deleteMany({ where: { stageId: { in: [PLAYOFF_STAGE_ID, SWISS_STAGE_ID] } } });
  await prismaClient.stage.deleteMany({ where: { id: { in: [PLAYOFF_STAGE_ID, SWISS_STAGE_ID] } } });
  await prismaClient.teamStats.deleteMany({
    where: { tournamentId: { in: [PLAYOFF_TOURNAMENT_ID, SWISS_TOURNAMENT_ID] } },
  });
  await prismaClient.team.deleteMany({
    where: { tournamentId: { in: [PLAYOFF_TOURNAMENT_ID, SWISS_TOURNAMENT_ID] } },
  });
  await prismaClient.tournament.deleteMany({
    where: { id: { in: [PLAYOFF_TOURNAMENT_ID, SWISS_TOURNAMENT_ID] } },
  });

  const playoffMatches = await seedPlayoffBracket(admin.id);
  const swissMatches = await seedSwissBracket(admin.id);

  const playoffSummary = await logBracketSummary(PLAYOFF_STAGE_ID);
  const swissSummary = await logBracketSummary(SWISS_STAGE_ID);

  console.log('Playoff bracket sample:', playoffSummary);
  console.log('Swiss bracket sample:', swissSummary);
  console.log('Playoff matches created:', playoffMatches.length);
  console.log('Swiss matches created:', swissMatches.length);
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
