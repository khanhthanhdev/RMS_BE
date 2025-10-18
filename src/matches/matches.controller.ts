import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { MatchTimeService } from './match-time.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { UpdateMatchDto, UpdateAllianceDto } from './dto/update-match.dto';
import { UpdateMatchTimeDto, BulkUpdateMatchTimesDto } from './dto/update-match-time.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole, MatchState } from '../utils/prisma-types';

@Controller('matches')
export class MatchesController {
  constructor(
    private readonly matchesService: MatchesService,
    private readonly matchTimeService: MatchTimeService
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() createMatchDto: CreateMatchDto) {
    return this.matchesService.create(createMatchDto);
  }

  @Get()
  findAll(
    @Query('fieldId') fieldId?: string,
    @Query('fieldNumber') fieldNumber?: string,
    @Query('tournamentId') tournamentId?: string,
    @Query('stageId') stageId?: string
  ) {
    // Convert fieldNumber to number if present
    const numFieldNumber = fieldNumber !== undefined ? Number(fieldNumber) : undefined;
    return this.matchesService.findAll({
      fieldId,
      fieldNumber: numFieldNumber,
      tournamentId,
      stageId
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matchesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() updateMatchDto: UpdateMatchDto) {
    return this.matchesService.update(id, updateMatchDto);
  }

  @Patch('alliance/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateAlliance(
    @Param('id') id: string,
    @Body() updateAllianceDto: UpdateAllianceDto
  ) {
    return this.matchesService.updateAlliance(id, updateAllianceDto);
  }
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(@Param('id') id: string, @Body() body: { status: MatchState }) {
    // Only allow status update
    return this.matchesService.update(id, { status: body.status });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.matchesService.remove(id);
  }

  // New time management endpoints
  @Patch(':id/time')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateMatchTime(@Param('id') id: string, @Body() updateMatchTimeDto: UpdateMatchTimeDto) {
    return this.matchTimeService.updateMatchTime(id, updateMatchTimeDto);
  }

  @Post('bulk-update-times')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  bulkUpdateMatchTimes(@Body() bulkUpdateDto: BulkUpdateMatchTimesDto) {
    return this.matchTimeService.bulkUpdateMatchTimes(bulkUpdateDto);
  }

  @Get('stage/:stageId/schedule')
  getStageSchedule(@Param('stageId') stageId: string) {
    return this.matchTimeService.getStageSchedule(stageId);
  }
}