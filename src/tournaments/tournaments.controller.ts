import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { FieldRefereesService } from '../field-referees/field-referees.service';
import { TeamsService } from '../teams/teams.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import {
  AssignRefereesDto,
  BatchAssignRefereesDto,
} from '../field-referees/dto/referee-assignment.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../utils/prisma-types';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('tournaments')
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly fieldRefereesService: FieldRefereesService,
    private readonly teamsService: TeamsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() createTournamentDto: CreateTournamentDto) {
    return this.tournamentsService.create(createTournamentDto);
  }

  @Get()
  findAll() {
    return this.tournamentsService.findAll();
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(
    @Param('id') id: string,
    @CurrentUser() user?: { id: string; role: string },
  ) {
    return this.tournamentsService.findOne(id, user);
  }

  @Get(':id/fields')
  getFieldsByTournament(@Param('id') id: string) {
    return this.tournamentsService.getFieldsByTournament(id);
  }

  @Get(':id/teams')
  @UseGuards(JwtAuthGuard)
  getTeamsByTournament(@Param('id') id: string) {
    return this.teamsService.findAll(id);
  }

  @Get(':id/details')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getTournamentDetails(@Param('id') id: string) {
    return this.tournamentsService.findOneWithFullDetails(id);
  }

  @Get(':id/fields-with-referees')
  async getFieldsWithReferees(@Param('id') id: string) {
    return this.tournamentsService.getFieldsWithRefereesByTournament(id);
  }

  @Get(':id/referees')
  async getTournamentReferees(@Param('id') id: string) {
    return this.fieldRefereesService.getRefereesByTournament(id);
  }

  @Get('referees/available')
  async getAvailableReferees() {
    return this.fieldRefereesService.getAvailableReferees();
  }

  @Post(':id/fields/:fieldId/referees')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async assignFieldReferees(
    @Param('fieldId') fieldId: string,
    @Body() assignmentDto: AssignRefereesDto,
  ) {
    return this.fieldRefereesService.assignRefereesToField(
      fieldId,
      assignmentDto.referees,
    );
  }

  @Delete(':id/fields/:fieldId/referees/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async removeFieldReferee(
    @Param('fieldId') fieldId: string,
    @Param('userId') userId: string,
  ) {
    return this.fieldRefereesService.removeRefereeFromField(fieldId, userId);
  }

  @Post(':id/referees/batch')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async batchAssignReferees(@Body() batchDto: BatchAssignRefereesDto) {
    return this.fieldRefereesService.batchAssignReferees(batchDto.assignments);
  }

  @Post(':id/fields/:fieldId/assign-to-match/:matchId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async assignMatchToField(
    @Param('fieldId') fieldId: string,
    @Param('matchId') matchId: string,
  ) {
    // This will use the MatchesService method that auto-assigns head referee
    const MatchesService = await import('../matches/matches.service');
    const DateValidationService = await import('../common/services/date-validation.service');
    const dateValidationService = new DateValidationService.DateValidationService(
      this.tournamentsService['prisma']
    );
    const matchesService = new MatchesService.MatchesService(
      this.tournamentsService['prisma'],
      null as any, // matchScoresService not needed for this operation
      null as any, // matchChangeDetectionService not needed for this operation
      dateValidationService,
    );
    return matchesService.assignMatchToField(matchId, fieldId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateTournamentDto: UpdateTournamentDto,
  ) {
    return this.tournamentsService.update(id, updateTournamentDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.tournamentsService.remove(id);
  }

  @Get(':id/date-boundaries')
  async getDateBoundaries(@Param('id') id: string) {
    return this.tournamentsService.getDateBoundaries(id);
  }

  @Post(':id/validate-date-update')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async validateDateUpdate(
    @Param('id') id: string,
    @Body() body: { startDate: string; endDate: string }
  ) {
    return this.tournamentsService.validateDateUpdate(
      id,
      new Date(body.startDate),
      new Date(body.endDate)
    );
  }

  @Get(':id/export')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async exportTournamentData(
    @Param('id') id: string,
    @Query('format') format: 'csv' | 'excel' | 'json' = 'csv'
  ) {
    return this.tournamentsService.exportData(id, format);
  }

  @Get(':id/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getTournamentSettings(@Param('id') id: string) {
    return this.tournamentsService.getSettings(id);
  }

  @Patch(':id/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateTournamentSettings(
    @Param('id') id: string,
    @Body() settings: any
  ) {
    return this.tournamentsService.updateSettings(id, settings);
  }

  @Get(':id/next-match')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HEAD_REFEREE)
  async getNextMatch(@Param('id') id: string) {
    return this.tournamentsService.getNextMatch(id);
  }

  @Post(':id/matches/:matchId/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.HEAD_REFEREE)
  async startMatch(
    @Param('id') tournamentId: string,
    @Param('matchId') matchId: string
  ) {
    return this.tournamentsService.startMatch(tournamentId, matchId);
  }

  @Post(':id/duplicate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async duplicateTournament(
    @Param('id') id: string,
    @Body() body: { name: string }
  ) {
    return this.tournamentsService.duplicate(id, body.name);
  }

  @Post(':id/stages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async createStage(
    @Param('id') tournamentId: string,
    @Body() createStageDto: any
  ) {
    return this.tournamentsService.createStage(tournamentId, createStageDto);
  }
}
