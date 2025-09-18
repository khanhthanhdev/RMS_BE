import { CreateMatchScoresDto } from '../dto';

export interface AllianceScoreInput {
  flagsSecured: number;
  successfulFlagHits: number;
  opponentFieldAmmo: number;
}

export interface LegacyAllianceScores {
  redAutoScore: number;
  redDriveScore: number;
  redTotalScore: number;
  blueAutoScore: number;
  blueDriveScore: number;
  blueTotalScore: number;
}

/**
 * Data Transfer Object for score operations under the revised tournament rules.
 * It normalises raw request payloads into strongly typed alliance inputs that the
 * scoring service can process, while retaining legacy totals for backwards compatibility.
 */
export class ScoreDataDto {
  constructor(
    public readonly matchId: string,
    public readonly redAlliance: AllianceScoreInput,
    public readonly blueAlliance: AllianceScoreInput,
    private readonly legacyScores: LegacyAllianceScores,
  ) {}

  /**
   * Creates ScoreDataDto from CreateMatchScoresDto
   */
  static fromCreateDto(dto: CreateMatchScoresDto): ScoreDataDto {
    const matchId = dto.matchId;
    const redAlliance = this.extractAllianceDetails(dto, 'red');
    const blueAlliance = this.extractAllianceDetails(dto, 'blue');

    const redAutoScore = Number((dto as any).redAutoScore ?? 0) || 0;
    const redDriveScore = Number((dto as any).redDriveScore ?? 0) || 0;
    const redTotalScore = Number((dto as any).redTotalScore ?? (redAutoScore + redDriveScore)) || 0;

    const blueAutoScore = Number((dto as any).blueAutoScore ?? 0) || 0;
    const blueDriveScore = Number((dto as any).blueDriveScore ?? 0) || 0;
    const blueTotalScore = Number((dto as any).blueTotalScore ?? (blueAutoScore + blueDriveScore)) || 0;

    const legacyScores: LegacyAllianceScores = {
      redAutoScore,
      redDriveScore,
      redTotalScore,
      blueAutoScore,
      blueDriveScore,
      blueTotalScore,
    };

    return new ScoreDataDto(matchId, redAlliance, blueAlliance, legacyScores);
  }

  /**
   * Ensures the DTO contains a match id and non-negative integer counts.
   */
  validate(): void {
    if (!this.matchId) {
      throw new Error('Match ID is required');
    }

    this.validateAlliance('red', this.redAlliance);
    this.validateAlliance('blue', this.blueAlliance);
  }

  /**
   * Indicates whether detailed score inputs were supplied.
   */
  hasDetailedInputs(): boolean {
    const redHasDetails = Object.values(this.redAlliance).some(value => value > 0);
    const blueHasDetails = Object.values(this.blueAlliance).some(value => value > 0);
    return redHasDetails || blueHasDetails;
  }

  getLegacyScores(): LegacyAllianceScores {
    return this.legacyScores;
  }

  private static extractAllianceDetails(dto: CreateMatchScoresDto, alliance: 'red' | 'blue'): AllianceScoreInput {
    const rawAllianceDetails = dto.scoreDetails?.[alliance] || {};
    const legacyPrefixed = (key: string) => (dto as any)[`${alliance}${key}`];

    return {
      flagsSecured: this.parseCount(
        rawAllianceDetails.flagsSecured ??
        rawAllianceDetails.protectedFlags ??
        rawAllianceDetails.flags ??
        legacyPrefixed('FlagsSecured') ??
        0,
      ),
      successfulFlagHits: this.parseCount(
        rawAllianceDetails.successfulFlagHits ??
        rawAllianceDetails.flagHits ??
        rawAllianceDetails.successfulShots ??
        legacyPrefixed('SuccessfulFlagHits') ??
        0,
      ),
      opponentFieldAmmo: this.parseCount(
        rawAllianceDetails.opponentFieldAmmo ??
        rawAllianceDetails.bulletsOnOpponentField ??
        rawAllianceDetails.ammoOnOpponentField ??
        legacyPrefixed('OpponentFieldAmmo') ??
        0,
      ),
    };
  }

  private static parseCount(value: unknown): number {
    const numericValue = Number(value ?? 0);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }
    return Math.max(0, Math.floor(numericValue));
  }

  private validateAlliance(label: 'red' | 'blue', alliance: AllianceScoreInput): void {
    const invalidEntries = Object.entries(alliance).filter(([, value]) => value < 0 || !Number.isInteger(value));
    if (invalidEntries.length > 0) {
      const fields = invalidEntries.map(([key]) => `${label}.${key}`).join(', ');
      throw new Error(`Invalid counts for alliance ${label.toUpperCase()}: ${fields} must be non-negative integers`);
    }
  }
}
