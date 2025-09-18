import { Injectable } from '@nestjs/common';
import { AllianceColor } from '../../utils/prisma-types';
import { AllianceScoreInput, LegacyAllianceScores } from '../dto/score-data.dto';

export interface AllianceScoreBreakdown {
  flagsPoints: number;
  flagHitsPoints: number;
  fieldControlPoints: number;
}

export interface AllianceScores {
  autoScore: number;
  driveScore: number;
  totalScore: number;
  breakdown: AllianceScoreBreakdown;
  input: AllianceScoreInput;
}

export interface MatchScores {
  redScores: AllianceScores;
  blueScores: AllianceScores;
  winningAlliance: AllianceColor | null;
}

/**
 * Service responsible for calculating match scores and determining winners
 */
@Injectable()
export class ScoreCalculationService {
  private readonly FLAG_POINTS = 20;
  private readonly FLAG_HIT_POINTS = 10;
  private readonly AMMO_POINTS = 5;

  /**
   * Calculates the score breakdown for a single alliance.
   */
  calculateAllianceScore(input: AllianceScoreInput): AllianceScores {
    this.validateAllianceInput(input);

    const flagsPoints = input.flagsSecured * this.FLAG_POINTS;
    const flagHitsPoints = input.successfulFlagHits * this.FLAG_HIT_POINTS;
    const fieldControlPoints = input.opponentFieldAmmo * this.AMMO_POINTS;

    const autoScore = flagsPoints;
    const driveScore = flagHitsPoints + fieldControlPoints;
    const totalScore = autoScore + driveScore;

    return {
      autoScore,
      driveScore,
      totalScore,
      breakdown: {
        flagsPoints,
        flagHitsPoints,
        fieldControlPoints,
      },
      input: { ...input },
    };
  }

  /**
   * Determines the winning alliance based on total scores
   */
  determineWinner(redTotalScore: number, blueTotalScore: number): AllianceColor | null {
    if (redTotalScore > blueTotalScore) return AllianceColor.RED;
    if (blueTotalScore > redTotalScore) return AllianceColor.BLUE;
    return null; // Tie
  }

  /**
   * Calculates match scores for both alliances and determines the winner
   */
  calculateMatchScores(redInput: AllianceScoreInput, blueInput: AllianceScoreInput): MatchScores {
    const redScores = this.calculateAllianceScore(redInput);
    const blueScores = this.calculateAllianceScore(blueInput);

    return {
      redScores,
      blueScores,
      winningAlliance: this.determineWinner(redScores.totalScore, blueScores.totalScore),
    };
  }

  buildLegacyMatchScores(
    legacyScores: LegacyAllianceScores,
    redInput: AllianceScoreInput,
    blueInput: AllianceScoreInput,
  ): MatchScores {
    const redScores: AllianceScores = {
      autoScore: legacyScores.redAutoScore,
      driveScore: legacyScores.redDriveScore,
      totalScore: legacyScores.redTotalScore,
      breakdown: {
        flagsPoints: legacyScores.redAutoScore,
        flagHitsPoints: legacyScores.redDriveScore,
        fieldControlPoints: 0,
      },
      input: { ...redInput },
    };

    const blueScores: AllianceScores = {
      autoScore: legacyScores.blueAutoScore,
      driveScore: legacyScores.blueDriveScore,
      totalScore: legacyScores.blueTotalScore,
      breakdown: {
        flagsPoints: legacyScores.blueAutoScore,
        flagHitsPoints: legacyScores.blueDriveScore,
        fieldControlPoints: 0,
      },
      input: { ...blueInput },
    };

    return {
      redScores,
      blueScores,
      winningAlliance: this.determineWinner(legacyScores.redTotalScore, legacyScores.blueTotalScore),
    };
  }

  private validateAllianceInput(input: AllianceScoreInput): void {
    const invalidEntries = Object.entries(input).filter(([, value]) => value < 0 || !Number.isInteger(value));
    if (invalidEntries.length > 0) {
      throw new Error('Alliance score inputs must be non-negative integers');
    }
  }
}
