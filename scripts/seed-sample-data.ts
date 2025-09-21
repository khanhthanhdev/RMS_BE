import {
  AllianceColor,
  MatchState,
  StageStatus,
  StageType,
  UserRole,
} from '../generated/prisma';
import { PrismaService } from '../src/prisma.service';

const prisma = new PrismaService();

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60 * 1000);

const ADMIN_USERNAME = 'sample.admin';
const TOURNAMENT_ID = 'sample-tournament';
const STAGE_ID = 'sample-stage';
const MATCH_ID = 'sample-match-1';

const TEAM_CONFIG = [
  { id: 'sample-team-1', number: 'S-101', name: 'Sample Robotics 1' },
  { id: 'sample-team-2', number: 'S-102', name: 'Sample Robotics 2' },
  { id: 'sample-team-3', number: 'S-103', name: 'Sample Robotics 3' },
  { id: 'sample-team-4', number: 'S-104', name: 'Sample Robotics 4' },
];

async function ensureAdmin() {
  const now = new Date();
  return prisma.user.upsert({
    where: { username: ADMIN_USERNAME },
    update: {
      name: 'Sample Admin',
      email: 'sample-admin@example.com',
      phoneNumber: '+19990000001',
      updatedAt: now,
    },
    create: {
      username: ADMIN_USERNAME,
      password: 'sample-password',
      role: UserRole.ADMIN,
      name: 'Sample Admin',
      email: 'sample-admin@example.com',
      phoneNumber: '+19990000001',
      gender: 'OTHER',
      isActive: true,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function upsertTeams(tournamentId: string) {
  const teams = [] as { id: string; teamNumber: string; name: string; ownerId: string }[];

  for (const config of TEAM_CONFIG) {
    const owner = await prisma.user.upsert({
      where: { username: `${config.id}-owner` },
      update: {
        email: `${config.id}@example.com`,
        phoneNumber: `+1999000${config.id.slice(-1)}01`,
      },
      create: {
        username: `${config.id}-owner`,
        password: 'sample-password',
        role: UserRole.TEAM_LEADER,
        name: `${config.name} Owner`,
        email: `${config.id}@example.com`,
        phoneNumber: `+1999000${config.id.slice(-1)}01`,
        gender: 'OTHER',
        isActive: true,
      },
    });

    const team = await prisma.team.upsert({
      where: { id: config.id },
      update: {
        teamNumber: config.number,
        name: config.name,
        tournamentId,
        userId: owner.id,
        referralSource: 'sample-seed',
      },
      create: {
        id: config.id,
        teamNumber: config.number,
        name: config.name,
        tournamentId,
        userId: owner.id,
        referralSource: 'sample-seed',
      },
    });

    teams.push({ id: team.id, teamNumber: team.teamNumber, name: team.name, ownerId: owner.id });
  }

  return teams;
}

async function createSampleData() {
  await prisma.onModuleInit();

  const admin = await ensureAdmin();

  const now = new Date();
  const tournament = await prisma.tournament.upsert({
    where: { id: TOURNAMENT_ID },
    update: {
      name: 'Sample Robotics Invitational',
      description: 'Sample data set for bracket testing',
      startDate: now,
      endDate: addMinutes(now, 60 * 24),
      adminId: admin.id,
      numberOfFields: 1,
    },
    create: {
      id: TOURNAMENT_ID,
      name: 'Sample Robotics Invitational',
      description: 'Sample data set for bracket testing',
      startDate: now,
      endDate: addMinutes(now, 60 * 24),
      adminId: admin.id,
      numberOfFields: 1,
    },
  });

  const teams = await upsertTeams(tournament.id);

  // Reset existing matches for the stage if any
  await prisma.match.deleteMany({ where: { stageId: STAGE_ID } });

  const stage = await prisma.stage.upsert({
    where: { id: STAGE_ID },
    update: {
      name: 'Sample Playoff Stage',
      description: 'Quarterfinal sample bracket',
      type: StageType.PLAYOFF,
      status: StageStatus.ACTIVE,
      startDate: now,
      endDate: addMinutes(now, 120),
      isElimination: true,
      teamsPerAlliance: 2,
      teams: {
        set: [],
        connect: teams.map((team) => ({ id: team.id })),
      },
    },
    create: {
      id: STAGE_ID,
      name: 'Sample Playoff Stage',
      description: 'Quarterfinal sample bracket',
      type: StageType.PLAYOFF,
      status: StageStatus.ACTIVE,
      startDate: now,
      endDate: addMinutes(now, 120),
      tournamentId: tournament.id,
      teamsPerAlliance: 2,
      isElimination: true,
      teams: {
        connect: teams.map((team) => ({ id: team.id })),
      },
    },
  });

  const match = await prisma.match.create({
    data: {
      id: MATCH_ID,
      stageId: stage.id,
      matchNumber: 1,
      roundNumber: 1,
      status: MatchState.PENDING,
      scheduledTime: addMinutes(now, 30),
      bracketSlot: 1,
      alliances: {
        create: [
          {
            color: AllianceColor.RED,
            teamAlliances: {
              create: [
                { teamId: teams[0].id, stationPosition: 1 },
                { teamId: teams[1].id, stationPosition: 2 },
              ],
            },
          },
          {
            color: AllianceColor.BLUE,
            teamAlliances: {
              create: [
                { teamId: teams[2].id, stationPosition: 1 },
                { teamId: teams[3].id, stationPosition: 2 },
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

  console.log('Sample data created successfully');
  console.log({
    tournament: tournament.id,
    stage: stage.id,
    match: match.id,
    teams: teams.map((team) => ({ id: team.id, number: team.teamNumber, name: team.name })),
  });
}

createSampleData()
  .catch((error) => {
    console.error('Failed to seed sample data', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
