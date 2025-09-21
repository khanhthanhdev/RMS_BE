import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { MatchSchedulerService } from './match-scheduler.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../utils/prisma-types';
import { FrcSchedulerConfig, PRESET_CONFIGS } from './frc-scheduler.config';
import { StagesService } from '../stages/stages.service';

/**
 * Controller for match scheduling operations.
 * Provides endpoints for generating different types of match schedules.
 */
@Controller('match-scheduler')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MatchSchedulerController {
    constructor(
        private readonly matchSchedulerService: MatchSchedulerService,
        private readonly stagesService: StagesService,
    ) { }

    /**
     * Generates a schedule using the FRC scheduling algorithm.
     * Creates a balanced schedule where teams play a specified number of matches.
     */
    @Post('generate-frc-schedule')
    @Roles(UserRole.ADMIN)
    async generateFrcSchedule(@Body() data: { 
        stageId: string;
        rounds?: number;
        teamsPerAlliance?: number;
        minMatchSeparation?: number;
        maxIterations?: number;
        qualityLevel?: 'low' | 'medium' | 'high';
        config?: Partial<FrcSchedulerConfig>;
        preset?: keyof typeof PRESET_CONFIGS;
    }) {
        const schedule = await this.matchSchedulerService.generateFrcSchedule(
            data.stageId,
            data.rounds,
            data.teamsPerAlliance || 2,
            data.minMatchSeparation || 1,
            data.maxIterations,
            data.qualityLevel || 'medium',
            data.config,
            data.preset
        );
        await this.stagesService.broadcastStageBracket(data.stageId);
        
        // Use stageId since stage object isn't available in the returned data
        const stageName = `ID ${data.stageId}`;
            
        return {
            message: `Successfully created ${schedule.length} matches for stage ${stageName}`,
            matches: schedule
        };
    }

    /**
     * Generates a schedule using custom FRC configuration.
     * Allows full control over all MatchMaker algorithm parameters.
     */
    @Post('generate-frc-schedule-advanced')
    @Roles(UserRole.ADMIN)
    async generateFrcScheduleAdvanced(@Body() data: { 
        stageId: string;
        config: FrcSchedulerConfig;
    }) {
        const schedule = await this.matchSchedulerService.generateFrcScheduleWithConfig(
            data.stageId,
            data.config
        );
        await this.stagesService.broadcastStageBracket(data.stageId);
        
        return {
            message: `Successfully created ${schedule.length} matches for stage ${data.stageId} with custom configuration`,
            matches: schedule,
            config: data.config
        };
    }

    /**
     * Get available preset configurations for FRC scheduling.
     */
    @Post('get-frc-presets')
    @Roles(UserRole.ADMIN)
    async getFrcPresets() {
        return {
            message: 'Available FRC scheduler presets',
            presets: Object.keys(PRESET_CONFIGS),
            configurations: PRESET_CONFIGS
        };
    }

    /**
     * Generates a new round for a Swiss-style tournament.
     * Pairs teams based on their current performance.
     */
    @Post('generate-swiss-round')
    @Roles(UserRole.ADMIN)
    async generateSwissRound(@Body() data: { 
        stageId: string; 
        currentRoundNumber: number;
        teamsPerAlliance?: number;
    }) {
        const matches = await this.matchSchedulerService.generateSwissRound(
            data.stageId, 
            data.currentRoundNumber,
            data.teamsPerAlliance || 2
        );
        await this.stagesService.broadcastStageBracket(data.stageId);
        
        return {
            message: `Successfully generated Swiss round ${data.currentRoundNumber + 1}`,
            matches
        };
    }

    /**
     * Updates Swiss-style rankings for all teams in a stage.
     * Call this after each round.
     */
    @Post('update-swiss-rankings/:stageId')
    @Roles(UserRole.ADMIN)
    async updateSwissRankings(@Param('stageId') stageId: string) {
        await this.matchSchedulerService.updateSwissRankings(stageId);
        return {
            message: `Swiss rankings updated for stage ${stageId}`
        };
    }

    /**
     * Gets Swiss-style rankings for a stage, ordered by all tiebreakers.
     */
    @Post('get-swiss-rankings/:stageId')
    @Roles(UserRole.ADMIN)
    async getSwissRankings(@Param('stageId') stageId: string) {
        const rankings = await this.matchSchedulerService.getSwissRankings(stageId);
        return {
            message: `Swiss rankings for stage ${stageId}`,
            rankings
        };
    }

    /**
     * Generates a playoff tournament schedule.
     * Creates elimination bracket based on team seeding.
     */
    @Post('generate-playoff')
    @Roles(UserRole.ADMIN)
    async generatePlayoffSchedule(@Body() data: { 
        stageId: string; 
        numberOfRounds: number;
        teamsPerAlliance?: number;
    }) {
        const matches = await this.matchSchedulerService.generatePlayoffSchedule(
            data.stageId, 
            data.numberOfRounds,
            data.teamsPerAlliance || 2
        );
        await this.stagesService.broadcastStageBracket(data.stageId);
        
        return {
            message: `Successfully generated playoff tournament with ${data.numberOfRounds} rounds`,
            matches
        };
    }

    /**
     * Updates playoff brackets after a match is completed.
     * Advances winning teams to next round.
     */
    @Post('update-playoff-brackets/:matchId')
    @Roles(UserRole.ADMIN)
    async updatePlayoffBrackets(@Param('matchId') matchId: string) {
        const updatedMatches = await this.matchSchedulerService.updatePlayoffBrackets(matchId);
        if (updatedMatches.length) {
            await this.stagesService.broadcastStageBracket(updatedMatches[0].stageId);
        }
        
        return {
            message: `Updated ${updatedMatches.length} playoff bracket matches`,
            matches: updatedMatches
        };
    }

    /**
     * Finalizes rankings for the playoff stage.
     * Determines final tournament placement based on bracket results.
     */
    @Post('finalize-playoff-rankings/:stageId')
    @Roles(UserRole.ADMIN)
    async finalizePlayoffRankings(@Param('stageId') stageId: string) {
        const finalMatches = await this.matchSchedulerService.finalizePlayoffRankings(stageId);
        await this.stagesService.broadcastStageBracket(stageId);
        
        return {
            message: `Finalized rankings for ${finalMatches.length} playoff matches`,
            matches: finalMatches
        };
    }
}
