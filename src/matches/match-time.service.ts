import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateMatchTimeDto, BulkUpdateMatchTimesDto } from './dto/update-match-time.dto';
import { MatchState } from '../utils/prisma-types';

@Injectable()
export class MatchTimeService {
  private readonly logger = new Logger(MatchTimeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Updates the scheduled time for a single match
   * @param matchId The ID of the match to update
   * @param updateDto Update data including new time and options
   */
  async updateMatchTime(matchId: string, updateDto: UpdateMatchTimeDto) {
    this.logger.log(`Updating time for match ${matchId}`);

    // Verify match exists and is in PENDING status
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        stage: {
          include: {
            tournament: {
              include: {
                fields: {
                  orderBy: { number: 'asc' }
                }
              }
            }
          }
        }
      }
    });

    if (!match) {
      throw new NotFoundException(`Match with ID ${matchId} not found`);
    }

    if (match.status !== MatchState.PENDING) {
      throw new BadRequestException(`Cannot update time for match that is not in PENDING status`);
    }

    // Update the match time
    const updatedMatch = await this.prisma.match.update({
      where: { id: matchId },
      data: {
        scheduledTime: updateDto.scheduledTime,
        startTime: updateDto.scheduledTime, // Also update startTime for consistency
      },
      include: {
        stage: true,
        field: true,
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
    });

    // If updateSubsequent is true, update all subsequent matches in the same stage
    if (updateDto.updateSubsequent) {
      await this.updateSubsequentMatches(
        match.stageId,
        match.matchNumber,
        updateDto.scheduledTime,
        updateDto.fieldIntervalMinutes || 5
      );
    }

    this.logger.log(`Successfully updated time for match ${matchId}`);
    return updatedMatch;
  }

  /**
   * Updates all subsequent matches in a stage starting from the given match number
   */
  private async updateSubsequentMatches(
    stageId: string,
    fromMatchNumber: number,
    baseTime: Date,
    fieldIntervalMinutes: number
  ) {
    // Get all subsequent matches in order
    const subsequentMatches = await this.prisma.match.findMany({
      where: {
        stageId,
        matchNumber: { gt: fromMatchNumber },
        status: MatchState.PENDING
      },
      include: {
        field: true
      },
      orderBy: [
        { matchNumber: 'asc' }
      ]
    });

    if (subsequentMatches.length === 0) {
      return;
    }

    // Get tournament fields for calculation
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      include: {
        tournament: {
          include: {
            fields: {
              orderBy: { number: 'asc' }
            }
          }
        }
      }
    });

    const fields = stage?.tournament?.fields || [];
    if (fields.length === 0) {
      throw new BadRequestException('No fields found for tournament');
    }

    // Calculate new times for subsequent matches
    const updates: Array<{ id: string; scheduledTime: Date; startTime: Date }> = [];
    let currentTime = new Date(baseTime);

    for (const match of subsequentMatches) {
      // Calculate time offset based on field assignment
      const fieldIndex = fields.findIndex(f => f.id === match.fieldId);
      const timeOffset = fieldIndex >= 0 ? fieldIndex * fieldIntervalMinutes : 0;
      
      // Calculate the base time for this match (considering previous matches)
      const matchOffset = (match.matchNumber - fromMatchNumber) * fieldIntervalMinutes;
      const newTime = new Date(baseTime.getTime() + (matchOffset * 60 * 1000) + (timeOffset * 60 * 1000));

      updates.push({
        id: match.id,
        scheduledTime: newTime,
        startTime: newTime
      });
    }

    // Batch update all subsequent matches
    await Promise.all(
      updates.map(update =>
        this.prisma.match.update({
          where: { id: update.id },
          data: {
            scheduledTime: update.scheduledTime,
            startTime: update.startTime
          }
        })
      )
    );

    this.logger.log(`Updated ${updates.length} subsequent matches`);
  }

  /**
   * Bulk updates match times for an entire stage
   * @param updateDto Bulk update parameters
   */
  async bulkUpdateMatchTimes(updateDto: BulkUpdateMatchTimesDto) {
    this.logger.log(`Bulk updating match times for stage ${updateDto.stageId}`);

    // Verify stage exists
    const stage = await this.prisma.stage.findUnique({
      where: { id: updateDto.stageId },
      include: {
        tournament: {
          include: {
            fields: {
              orderBy: { number: 'asc' }
            }
          }
        }
      }
    });

    if (!stage) {
      throw new NotFoundException(`Stage with ID ${updateDto.stageId} not found`);
    }

    const fields = stage.tournament?.fields || [];
    if (fields.length === 0) {
      throw new BadRequestException('No fields found for tournament');
    }

    // Get matches to update
    const whereCondition: any = {
      stageId: updateDto.stageId
    };

    // If not resetting all times, only update pending matches
    if (!updateDto.resetAllTimes) {
      whereCondition.status = MatchState.PENDING;
    }

    const matches = await this.prisma.match.findMany({
      where: whereCondition,
      include: {
        field: true
      },
      orderBy: [
        { matchNumber: 'asc' }
      ]
    });

    if (matches.length === 0) {
      throw new BadRequestException('No matches found to update');
    }

    // Calculate new times using the field interval strategy
    const updates = this.calculateMatchTimes(
      matches,
      fields,
      updateDto.startTime,
      updateDto.matchIntervalMinutes || 10,
      updateDto.fieldIntervalMinutes || 5
    );

    // Batch update all matches
    await Promise.all(
      updates.map(update =>
        this.prisma.match.update({
          where: { id: update.id },
          data: {
            scheduledTime: update.scheduledTime,
            startTime: update.scheduledTime
          }
        })
      )
    );

    this.logger.log(`Successfully updated ${updates.length} matches for stage ${updateDto.stageId}`);
    return { updated: updates.length };
  }

  /**
   * Calculates match times using field interval strategy
   * Field 1: 8:00, Field 2: 8:05, Field 3: 8:10, etc.
   * Next round: Field 1: 8:10, Field 2: 8:15, Field 3: 8:20, etc.
   */
  private calculateMatchTimes(
    matches: any[],
    fields: any[],
    startTime: Date,
    matchIntervalMinutes: number,
    fieldIntervalMinutes: number
  ): Array<{ id: string; scheduledTime: Date }> {
    const updates: Array<{ id: string; scheduledTime: Date }> = [];
    const fieldCount = fields.length;

    // Group matches by round if roundNumber exists, otherwise treat each match as its own "round"
    const matchesByRound = new Map<number, any[]>();
    
    for (const match of matches) {
      const roundNumber = match.roundNumber || 1;
      if (!matchesByRound.has(roundNumber)) {
        matchesByRound.set(roundNumber, []);
      }
      matchesByRound.get(roundNumber)!.push(match);
    }

    const sortedRounds = Array.from(matchesByRound.keys()).sort((a, b) => a - b);
    let currentRoundStartTime = new Date(startTime);

    for (const roundNumber of sortedRounds) {
      const roundMatches = matchesByRound.get(roundNumber)!;
      
      // Sort matches in round by field number for consistent ordering
      roundMatches.sort((a, b) => {
        const fieldA = fields.find(f => f.id === a.fieldId);
        const fieldB = fields.find(f => f.id === b.fieldId);
        const fieldNumberA = fieldA?.number || 999;
        const fieldNumberB = fieldB?.number || 999;
        return fieldNumberA - fieldNumberB;
      });

      // Assign times within the round
      for (let i = 0; i < roundMatches.length; i++) {
        const match = roundMatches[i];
        const field = fields.find(f => f.id === match.fieldId);
        const fieldNumber = field?.number || 1;
        
        // Calculate time offset: field interval * (field number - 1)
        const fieldOffset = (fieldNumber - 1) * fieldIntervalMinutes;
        const matchTime = new Date(currentRoundStartTime.getTime() + (fieldOffset * 60 * 1000));

        updates.push({
          id: match.id,
          scheduledTime: matchTime
        });
      }

      // Move to next round start time
      currentRoundStartTime = new Date(currentRoundStartTime.getTime() + (matchIntervalMinutes * 60 * 1000));
    }

    return updates;
  }

  /**
   * Gets the current time schedule for a stage
   */
  async getStageSchedule(stageId: string) {
    const matches = await this.prisma.match.findMany({
      where: { stageId },
      include: {
        field: true,
        stage: {
          include: {
            tournament: true
          }
        },
        alliances: {
          include: {
            teamAlliances: {
              include: {
                team: true
              }
            }
          }
        }
      },
      orderBy: [
        { scheduledTime: 'asc' },
        { matchNumber: 'asc' }
      ]
    });

    return matches;
  }
}
