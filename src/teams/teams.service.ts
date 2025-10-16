import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTeamDto, CreateTeamMemberDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { ImportTeamsDto } from './dto/import-teams.dto';
import { CreateBulkTeamsDto } from './dto/create-bulk-teams.dto';
import { DateValidationService } from '../common/services/date-validation.service';
import { Gender, TeamMember } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { EmailsService } from '../emails/emails.service';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailsService,
    private readonly dateValidationService: DateValidationService,
  ) {}

  /**
   * Generate a sequential team number in the format 000001, 000002, etc.
   */
  private async generateNextTeamNumber(tournamentId: string): Promise<string> {
    try {
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true, name: true },
      });

      if (!tournament || !tournament.name) {
        throw new Error(`Tournament not found for ID: ${tournamentId}`);
      }

      const prefix = tournament.name
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase())
        .join('');

      const latestTeam = await this.prisma.team.findFirst({
        where: {
          tournamentId: tournament.id,
          teamNumber: { startsWith: prefix },
        },
        orderBy: { teamNumber: 'desc' },
      });

      const latestNumber = latestTeam?.teamNumber
        ? parseInt(latestTeam.teamNumber.replace(prefix, ''), 10) || 0
        : 0;

      const newTeamNumber = `${prefix}${String(latestNumber + 1).padStart(5, '0')}`;
      return newTeamNumber;
    } catch (error) {
      console.error('Error generating team number:', error);
      // Generate a fallback random 6-digit number
      return `TMP${Math.floor(100000 + Math.random() * 900000)}`;
    }
  }

  /**
   * Check if a team exists by ID. Throws NotFoundException if not found.
   */
  private async ensureTeamExistsById(id: string) {
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }
    return team;
  }

  /**
   * Check if a team number is unique (not used by another team).
   * Throws BadRequestException if not unique.
   */
  private async ensureTeamNumberUnique(teamNumber: string, excludeId?: string) {
    const existingTeam = await this.prisma.team.findUnique({
      where: { teamNumber },
    });
    if (existingTeam && existingTeam.id !== excludeId) {
      throw new BadRequestException(
        `Team with number ${teamNumber} already exists`,
      );
    }
  }

  /**
   * Parse teamMembers from DTO, handling string/array/object.
   */
  private parseTeamMembers(input: any): any {
    if (input === undefined) return undefined;
    if (Array.isArray(input)) return input;
    if (typeof input === 'string') {
      try {
        return JSON.parse(input);
      } catch (error) {
        throw new BadRequestException(
          `Invalid teamMembers format: ${error.message}`,
        );
      }
    }
    return input;
  }

  private async createTeamMember(
    createTeamMemberDto: CreateTeamMemberDto,
    teamName: string,
    tournamentName: string,
  ) {
    try {
      const member = await this.prisma.teamMember.create({
        data: {
          name: createTeamMemberDto.name,
          gender: createTeamMemberDto.gender,
          phoneNumber: createTeamMemberDto.phoneNumber,
          email: createTeamMemberDto.email,
          province: createTeamMemberDto.province,
          ward: createTeamMemberDto.ward,
          organization: createTeamMemberDto.organization,
          organizationAddress: createTeamMemberDto.organizationAddress,
          team: {
            connect: { id: createTeamMemberDto.teamId },
          },
        },
      });

      if (member.email) {
        await this.emailService.sendTeamAssignmentInvitationEmail(
          member.email,
          teamName,
          tournamentName,
        );
      }

      return member;
    } catch (error) {
      throw new BadRequestException(
        `Failed to create team member: ${error.message}`,
      );
    }
  }

  async createTeam(createTeamDto: CreateTeamDto) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: createTeamDto.tournamentId },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        registrationDeadline: true,
        maxTeams: true,
        _count: {
          select: {
            teams: true
          }
        }
      }
    });

    if (!tournament) {
      throw new BadRequestException(
        `Tournament with ID ${createTeamDto.tournamentId} does not exist.`,
      );
    }

    // Validate team registration timing
    const registrationDate = new Date();
    const registrationValidation = await this.dateValidationService.validateTeamRegistrationTiming(
      registrationDate,
      createTeamDto.tournamentId
    );

    if (!registrationValidation.isValid) {
      throw new BadRequestException(
        `Cannot register team: ${registrationValidation.errors.join('; ')}`
      );
    }

    // Check registration deadline if set
    if (tournament.registrationDeadline && registrationDate > tournament.registrationDeadline) {
      throw new BadRequestException(
        `Registration deadline has passed (${tournament.registrationDeadline.toLocaleDateString()})`
      );
    }

    // Check maximum teams limit if set
    if (tournament.maxTeams && tournament._count.teams >= tournament.maxTeams) {
      throw new BadRequestException(
        `Tournament has reached its maximum limit of ${tournament.maxTeams} teams. No new teams can be registered.`
      );
    }

    const teamNumber = await this.generateNextTeamNumber(tournament.id);

    try {
      const createdTeam = await this.prisma.team.create({
        data: {
          teamNumber,
          name: createTeamDto.name,
          referralSource: createTeamDto.referralSource,
          tournament: {
            connect: { id: tournament.id },
          },
          user: {
            connect: { id: createTeamDto.userId },
          },
        },
        include: {
          tournament: true,
        },
      });

      const createdMembers = await Promise.all(
        createTeamDto.teamMembers.map((memberDto) =>
          this.createTeamMember(
            {
              ...memberDto,
              teamId: createdTeam.id,
            },
            createTeamDto.name,
            tournament.name,
          ),
        ),
      );

      return {
        ...createdTeam,
        teamMembers: createdMembers,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to create team: ${error.message}`);
    }
  }

  async findAll(tournamentId?: string) {
    const where = tournamentId ? { tournamentId } : {};

    const teams = await this.prisma.team.findMany({
      where,
      include: {
        tournament: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        teamMembers: true,
        _count: {
          select: { teamMembers: true },
        },
      },
      orderBy: {
        teamNumber: 'asc',
      },
    });

    // Add team member count for frontend compatibility
    return teams.map(team => ({
      ...team,
      teamMemberCount: team.teamMembers?.length || 0,
    }));
  }

  /**
   * Find all teams where the user is the owner/creator
   * This method supports the current single-owner model
   * TODO: Extend to support multi-team membership when schema is updated
   */
  async findTeamsByUserId(userId: string) {
    const teams = await this.prisma.team.findMany({
      where: {
        userId: userId,
      },
      include: {
        tournament: true,
        teamMembers: true,
        _count: {
          select: { teamMembers: true },
        },
      },
      orderBy: [
        { tournament: { startDate: 'desc' } },
        { teamNumber: 'asc' },
      ],
    });

    // Add team member count for frontend compatibility
    return teams.map(team => ({
      ...team,
      teamMemberCount: team.teamMembers?.length || 0,
    }));
  }

  async findOne(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        tournament: true,
        teamMembers: true,
        _count: {
          select: { teamMembers: true },
        },
        teamAlliances: {
          include: {
            alliance: {
              include: {
                match: {
                  include: {
                    stage: {
                      include: { tournament: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }

    // Add team member count for frontend compatibility
    return {
      ...team,
      teamMemberCount: team.teamMembers?.length || 0,
    };
  }

  async update(updateTeamDto: UpdateTeamDto) {
    if (!updateTeamDto.id) {
      throw new Error('Team ID is required');
    }

    const team = await this.prisma.team.findUnique({
      where: { id: updateTeamDto.id },
      include: { tournament: true },
    });

    if (!team) {
      throw new Error('Team not found');
    }

    const teamMemberUpdates = updateTeamDto.teamMembers ?? [];

    const existingMembers = await this.prisma.teamMember.findMany({
      where: { teamId: updateTeamDto.id },
      select: { id: true },
    });

    const incomingIds = teamMemberUpdates
      .filter((member) => member.id)
      .map((member) => member.id);

    const idsToDelete = existingMembers
      .map((member) => member.id)
      .filter((id) => !incomingIds.includes(id));

    if (idsToDelete.length > 0) {
      await this.prisma.teamMember.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    for (const member of teamMemberUpdates) {
      const { id, ...fields } = member;

      const data = Object.fromEntries(
        Object.entries(fields).filter(([_, v]) => v !== undefined),
      );

      if (id) {
        if (Object.keys(data).length > 0) {
          await this.prisma.teamMember.update({
            where: { id },
            data,
          });
        }
      } else {
        await this.createTeamMember(
          {
            name: data.name!,
            email: data.email!,
            phoneNumber: data.phoneNumber!,
            province: data.province!,
            ward: data.ward!,
            organization: data.organization!,
            organizationAddress: data.organizationAddress!,
            teamId: updateTeamDto.id,
          },
          team.name,
          team.tournament.name,
        );
      }
    }

    const teamData: any = {};
    if (updateTeamDto.name !== undefined) teamData.name = updateTeamDto.name;
    if (updateTeamDto.referralSource !== undefined)
      teamData.referralSource = updateTeamDto.referralSource;

    try {
      return this.prisma.team.update({
        where: { id: updateTeamDto.id },
        data: teamData,
        include: { tournament: true, teamMembers: true },
      });
    } catch (error) {
      throw new BadRequestException(`Failed to update team: ${error.message}`);
    }
  }

  async remove(id: string) {
    await this.ensureTeamExistsById(id);
    return this.prisma.team.delete({ where: { id } });
  }

  /**
   * Import multiple teams from CSV content for quick team creation
   * CSV format: Team Name,Email,Number of member,School/Organization,Location
   */
  async importTeams(importTeamsDto: ImportTeamsDto) {
    const {
      content,
      hasHeader = true,
      delimiter = ',',
      tournamentId,
    } = importTeamsDto;

    try {
      const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
      const dataLines = hasHeader ? lines.slice(1) : lines;

      if (dataLines.length === 0) {
        throw new BadRequestException('No team data found in the content');
      }

      // Verify tournament exists
      const tournament = await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true, name: true },
      });

      if (!tournament) {
        throw new BadRequestException(`Tournament with ID ${tournamentId} not found`);
      }

      // Get an admin user to assign as team owner
      const adminUser = await this.prisma.user.findFirst({
        where: { role: 'ADMIN' }
      });

      if (!adminUser) {
        throw new BadRequestException('No admin user found to assign as team owner');
      }

      const teamsToCreate: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < dataLines.length; i++) {
        const line = dataLines[i];
        const lineNumber = hasHeader ? i + 2 : i + 1; // Account for header row

        try {
          const parts = line.split(delimiter).map((part) => part.trim());

          if (parts.length < 5) {
            errors.push(`Line ${lineNumber}: Expected 5 columns, got ${parts.length}`);
            continue;
          }

          const [teamName, email, numberOfMembersStr, schoolOrganization, location] = parts;

          // Validate required fields
          if (!teamName) {
            errors.push(`Line ${lineNumber}: Team name is required`);
            continue;
          }

          const numberOfMembers = parseInt(numberOfMembersStr, 10);
          if (isNaN(numberOfMembers) || numberOfMembers < 1) {
            errors.push(`Line ${lineNumber}: Number of members must be a positive integer`);
            continue;
          }

          // Validate email if provided
          if (email && !/\S+@\S+\.\S+/.test(email)) {
            errors.push(`Line ${lineNumber}: Invalid email format`);
            continue;
          }

          teamsToCreate.push({
            teamName,
            email,
            numberOfMembers,
            schoolOrganization,
            location,
            lineNumber,
          });

        } catch (error) {
          errors.push(`Line ${lineNumber}: ${error.message}`);
        }
      }

      if (teamsToCreate.length === 0) {
        throw new BadRequestException(`No valid teams to import. Errors: ${errors.join('; ')}`);
      }

      const createdTeams: any[] = [];
      const creationErrors: string[] = [];

      for (const teamData of teamsToCreate) {
        try {
          // Create team members based on numberOfMembers
          const teamMembers: any[] = [];
          for (let i = 1; i <= teamData.numberOfMembers; i++) {
            // Create dummy team member data
            const memberName = i === 1 && teamData.email
              ? `Team Leader ${teamData.teamName}`
              : `Member ${i} - ${teamData.teamName}`;

            teamMembers.push({
              name: memberName,
              email: i === 1 ? teamData.email : undefined, // Only first member gets the email
              phoneNumber: undefined,
              gender: i % 2 === 0 ? 'MALE' : 'FEMALE', // Alternate genders for variety
              province: teamData.location || 'Unknown',
              ward: 'Default Ward',
              organization: teamData.schoolOrganization || 'Unknown Organization',
              organizationAddress: teamData.location || 'Unknown Address',
            });
          }

          // Create team using the normal registration process
          const createTeamDto: CreateTeamDto = {
            name: teamData.teamName,
            userId: adminUser.id,
            tournamentId: tournamentId,
            referralSource: 'CSV Import',
            teamMembers: teamMembers,
          };

          const createdTeam = await this.createTeam(createTeamDto);

          createdTeams.push({
            ...createdTeam,
            teamMemberCount: createdTeam.teamMembers?.length || 0,
          });

        } catch (error) {
          creationErrors.push(`Team "${teamData.teamName}" (line ${teamData.lineNumber}): ${error.message}`);
        }
      }

      const result = {
        success: creationErrors.length === 0,
        message: `Successfully imported ${createdTeams.length} teams${creationErrors.length > 0 ? ` with ${creationErrors.length} errors` : ''}`,
        teams: createdTeams,
        totalParsed: teamsToCreate.length,
        totalCreated: createdTeams.length,
        errors: [...errors, ...creationErrors],
      };

      if (creationErrors.length > 0) {
        result.message += `. Errors: ${creationErrors.join('; ')}`;
      }

      return result;

    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Failed to import teams: ${error.message}`);
    }
  }

  /**
   * Create multiple teams with random data for testing purposes (ADMIN only)
   */
  async createBulkTeams(createBulkTeamsDto: CreateBulkTeamsDto) {
    const { tournamentId, numberOfTeams } = createBulkTeamsDto;

    // Verify tournament exists
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, name: true },
    });

    if (!tournament) {
      throw new NotFoundException(`Tournament with ID ${tournamentId} not found`);
    }

    // Random data generators
    const teamNamePrefixes = [
      'Robotics Warriors', 'Tech Titans', 'Code Crushers', 'Gear Guardians', 
      'Circuit Breakers', 'Bolt Builders', 'Cyber Samurais', 'Digital Dynamos',
      'Electric Eagles', 'Fusion Force', 'Galaxy Gears', 'Heavy Metal',
      'Iron Lions', 'Java Jaguars', 'Kinetic Knights', 'Logic Legends',
      'Mech Masters', 'Nano Knights', 'Omega Operators', 'Power Pumas',
      'Quantum Quests', 'Robo Raptors', 'Steel Spartans', 'Tech Tigers',
      'Ultra Units', 'Vector Vipers', 'Wire Wolves', 'X-Force',
      'Yield Yaks', 'Zero Zone'
    ];

    const provinces = [
      'Hà Nội', 'Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ',
      'An Giang', 'Bà Rịa - Vũng Tàu', 'Bắc Giang', 'Bắc Kạn', 'Bạc Liêu',
      'Bắc Ninh', 'Bến Tre', 'Bình Định', 'Bình Dương', 'Bình Phước',
      'Bình Thuận', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Đắk Nông'
    ];

    const wards = [
      'Phường 1', 'Phường 2', 'Phường 3', 'Phường Trung Tâm',
      'Phường Đông', 'Phường Tây', 'Phường Nam', 'Phường Bắc',
      'Xã Hòa Bình', 'Xã Thành Công', 'Xã Đại Thành', 'Xã Hưng Thịnh'
    ];

    const organizations = [
      'THPT Chu Văn An', 'THPT Lê Quý Đôn', 'THPT Nguyễn Huệ',
      'Trường THCS Trần Phú', 'THPT Chuyên Lê Hồng Phong',
      'Đại học Bách Khoa', 'Đại học Công Nghệ', 'CLB Robotics',
      'Trung tâm STEM', 'Maker Space', 'Innovation Hub'
    ];

    const referralSources = [
      'Social Media', 'Website', 'Friends', 'School', 'Advertisement',
      'Event', 'Competition', 'Workshop', 'Teacher Recommendation'
    ];

    const firstNames = [
      'Minh', 'Hương', 'Tuấn', 'Linh', 'Đức', 'Mai', 'Hùng', 'Thảo',
      'Quang', 'Nhung', 'Bình', 'Lan', 'Việt', 'Thu', 'Nam', 'Hà',
      'Khôi', 'Trang', 'Phong', 'Ngọc', 'Hoàng', 'Yến', 'Trung', 'Hoa'
    ];

    const lastNames = [
      'Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ',
      'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'
    ];

    const createdTeams: any[] = [];

    try {
      // Get an admin user to assign as team owner
      const adminUser = await this.prisma.user.findFirst({ 
        where: { role: 'ADMIN' } 
      });

      if (!adminUser) {
        throw new BadRequestException('No admin user found to assign as team owner');
      }

      for (let i = 0; i < numberOfTeams; i++) {
        // Generate random team data
        const teamName = `${teamNamePrefixes[Math.floor(Math.random() * teamNamePrefixes.length)]} ${Math.floor(Math.random() * 1000)}`;
        const teamNumber = await this.generateNextTeamNumber(tournamentId);
        const referralSource = referralSources[Math.floor(Math.random() * referralSources.length)];

        // Generate random team members (2-4 members per team)
        const memberCount = Math.floor(Math.random() * 3) + 2; // 2-4 members
        const teamMembers: any[] = [];

        for (let j = 0; j < memberCount; j++) {
          const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
          const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
          const fullName = `${lastName} ${firstName}`;
          const province = provinces[Math.floor(Math.random() * provinces.length)];
          const ward = wards[Math.floor(Math.random() * wards.length)];
          const organization = organizations[Math.floor(Math.random() * organizations.length)];
          const gender = Math.random() > 0.5 ? 'MALE' : 'FEMALE';

          teamMembers.push({
            name: fullName,
            gender: gender as Gender,
            phoneNumber: `09${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`,
            email: `${firstName.toLowerCase()}${lastName.toLowerCase()}${Math.floor(Math.random() * 1000)}@email.com`,
            province: province,
            ward: ward,
            organization: organization,
            organizationAddress: `${Math.floor(Math.random() * 999) + 1} Đường ${Math.floor(Math.random() * 50) + 1}, ${ward}, ${province}`,
          });
        }

        // Create team with members
        const team = await this.prisma.team.create({
          data: {
            teamNumber,
            name: teamName,
            tournamentId,
            userId: adminUser.id,
            referralSource,
            teamMembers: {
              create: teamMembers,
            },
          },
          include: {
            teamMembers: true,
            tournament: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        createdTeams.push(team);
      }

      return {
        success: true,
        message: `Successfully created ${numberOfTeams} teams for tournament ${tournament.name}`,
        teams: createdTeams,
        count: createdTeams.length,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to create bulk teams: ${error.message}`);
    }
  }
}
