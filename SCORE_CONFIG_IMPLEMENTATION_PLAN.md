# Score-Config Feature Implementation Plan

## 🎯 Overview

This document outlines the detailed implementation plan for the score-config feature in RMS_BE. The goal is to create a flexible scoring system where:

- **ADMIN** can create score profiles with periods, elements, formulas, and penalties
- **ADMIN** assigns score profiles to tournaments
- All matches in a tournament use the assigned score profile
- Score panels in `/control-match` and `/audience-display` adapt to the profile
- The system scales to support many tournaments with different scoring rules

## 📋 Current State Analysis

### ✅ What's Working
- Basic score-config module with CRUD operations
- Strategy pattern for condition evaluation
- Tournament and match management
- Real-time WebSocket updates
- Role-based access control

### ❌ Critical Issues
- Score persistence gap in calculation service
- No tournament-profile integration
- Hardcoded scoring logic in match-scores
- Missing frontend integration
- No profile versioning/locking
- Formula security vulnerabilities

## 🚀 Implementation Phases

---

## Phase 1: Foundation & Critical Fixes (Week 1-2)

### Step 1.1: Database Schema Updates

#### 1.1.1 Add Profile Versioning Support
```bash
# Create migration
npx prisma migrate dev --name add_score_config_versioning
```

**Migration Content:**
```sql
-- Add versioning to score configs
ALTER TABLE "ScoreConfig" ADD COLUMN "version" INTEGER DEFAULT 1;
ALTER TABLE "ScoreConfig" ADD COLUMN "status" TEXT DEFAULT 'draft';
ALTER TABLE "ScoreConfig" ADD COLUMN "isLocked" BOOLEAN DEFAULT false;
ALTER TABLE "ScoreConfig" ADD COLUMN "lockedAt" TIMESTAMP;
ALTER TABLE "ScoreConfig" ADD COLUMN "publishedAt" TIMESTAMP;

-- Create score config versions table for immutable snapshots
CREATE TABLE "ScoreConfigVersion" (
    "id" TEXT NOT NULL,
    "scoreConfigId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    
    CONSTRAINT "ScoreConfigVersion_pkey" PRIMARY KEY ("id")
);

-- Add foreign keys
ALTER TABLE "ScoreConfigVersion" ADD CONSTRAINT "ScoreConfigVersion_scoreConfigId_fkey" 
    FOREIGN KEY ("scoreConfigId") REFERENCES "ScoreConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreConfigVersion" ADD CONSTRAINT "ScoreConfigVersion_createdBy_fkey" 
    FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add unique constraint
ALTER TABLE "ScoreConfigVersion" ADD CONSTRAINT "ScoreConfigVersion_scoreConfigId_version_key" 
    UNIQUE ("scoreConfigId", "version");
```

#### 1.1.2 Add Tournament-Profile Relationship
```sql
-- Link tournaments to score configs
ALTER TABLE "Tournament" ADD COLUMN "scoreConfigId" TEXT;
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_scoreConfigId_fkey" 
    FOREIGN KEY ("scoreConfigId") REFERENCES "ScoreConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add profile version to matches for reproducibility
ALTER TABLE "Match" ADD COLUMN "scoreConfigVersionId" TEXT;
ALTER TABLE "Match" ADD CONSTRAINT "Match_scoreConfigVersionId_fkey" 
    FOREIGN KEY ("scoreConfigVersionId") REFERENCES "ScoreConfigVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

#### 1.1.3 Add Audit Trail Support
```sql
-- Score config audit log
CREATE TABLE "ScoreConfigAudit" (
    "id" TEXT NOT NULL,
    "scoreConfigId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValues" JSONB,
    "newValues" JSONB,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT "ScoreConfigAudit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ScoreConfigAudit" ADD CONSTRAINT "ScoreConfigAudit_scoreConfigId_fkey" 
    FOREIGN KEY ("scoreConfigId") REFERENCES "ScoreConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoreConfigAudit" ADD CONSTRAINT "ScoreConfigAudit_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

#### 1.1.4 Update Prisma Schema
**File:** `prisma/schema.prisma`
```prisma
model ScoreConfig {
  id                String             @id @default(uuid())
  tournamentId      String?
  name              String
  description       String?
  version           Int                @default(1)
  status            String             @default("draft") // draft, published, archived
  isLocked          Boolean            @default(false)
  lockedAt          DateTime?
  publishedAt       DateTime?
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  
  // Relationships
  tournament        Tournament?        @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  scoreElements     ScoreElement[]
  bonusConditions   BonusCondition[]
  penaltyConditions PenaltyCondition[]
  versions          ScoreConfigVersion[]
  auditLogs         ScoreConfigAudit[]
  tournaments       Tournament[]       @relation("TournamentScoreConfig")
  
  @@index([tournamentId])
  @@index([status])
}

model ScoreConfigVersion {
  id              String    @id @default(uuid())
  scoreConfigId   String
  version         Int
  configSnapshot  Json      // Complete config at time of publish
  createdAt       DateTime  @default(now())
  createdBy       String
  
  scoreConfig     ScoreConfig @relation(fields: [scoreConfigId], references: [id], onDelete: Cascade)
  creator         User        @relation(fields: [createdBy], references: [id], onDelete: Restrict)
  matches         Match[]
  
  @@unique([scoreConfigId, version])
  @@index([scoreConfigId])
}

model ScoreConfigAudit {
  id            String    @id @default(uuid())
  scoreConfigId String
  action        String    // CREATE, UPDATE, DELETE, PUBLISH, LOCK, ASSIGN
  oldValues     Json?
  newValues     Json?
  userId        String
  timestamp     DateTime  @default(now())
  
  scoreConfig   ScoreConfig @relation(fields: [scoreConfigId], references: [id], onDelete: Cascade)
  user          User        @relation(fields: [userId], references: [id], onDelete: Restrict)
  
  @@index([scoreConfigId])
  @@index([userId])
  @@index([timestamp])
} 

model Tournament {
  // ... existing fields
  scoreConfigId   String?
  scoreConfig     ScoreConfig? @relation("TournamentScoreConfig", fields: [scoreConfigId], references: [id])
  
  @@index([scoreConfigId])
}

model Match {
  // ... existing fields
  scoreConfigVersionId String?
  scoreConfigVersion   ScoreConfigVersion? @relation(fields: [scoreConfigVersionId], references: [id])
  
  @@index([scoreConfigVersionId])
}

model User {
  // ... existing fields
  scoreConfigVersions ScoreConfigVersion[]
  scoreConfigAudits   ScoreConfigAudit[]
}
```

### Step 1.2: Fix Score Calculation Service

#### 1.2.1 Create Enhanced Score Calculation Service
**File:** `src/score-config/score-calculation.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConditionEvaluatorFactory } from './strategies/condition-evaluator.factory';
import { Condition } from './interfaces/condition.interface';

interface ScoreCalculationResult {
  matchId: string;
  allianceId: string;
  scoreConfigVersionId: string;
  elementScores: ElementScore[];
  bonusesEarned: BonusScore[];
  penaltiesIncurred: PenaltyScore[];
  totalScore: number;
  calculationLog: CalculationLog;
  timestamp: Date;
}

interface ElementScore {
  elementId: string;
  elementCode: string;
  elementName: string;
  units: number;
  pointsPerUnit: number;
  totalPoints: number;
  category?: string;
}

@Injectable()
export class ScoreCalculationService {
  constructor(
    private prisma: PrismaService,
    private conditionEvaluatorFactory: ConditionEvaluatorFactory,
  ) {}

  async calculateMatchScore(
    matchId: string,
    allianceId: string,
    elementScores: Record<string, number>,
    scoreConfigVersionId?: string
  ): Promise<ScoreCalculationResult> {
    // Get match with tournament info
    const match = await this.getMatchWithTournament(matchId);
    
    // Get score config version
    const configVersion = await this.getScoreConfigVersion(
      scoreConfigVersionId || match.scoreConfigVersionId,
      match.stage.tournament.scoreConfigId
    );
    
    // Validate alliance exists
    await this.validateAlliance(allianceId);
    
    // Parse config from snapshot
    const config = this.parseConfigSnapshot(configVersion.configSnapshot);
    
    // Calculate element scores
    const elementResults = this.calculateElementScores(config.scoreElements, elementScores);
    
    // Calculate bonus scores
    const bonusResults = this.calculateBonusScores(config.bonusConditions, elementScores);
    
    // Calculate penalty scores
    const penaltyResults = this.calculatePenaltyScores(config.penaltyConditions, elementScores);
    
    // Calculate total
    const totalScore = this.calculateTotalScore(elementResults, bonusResults, penaltyResults);
    
    // Create calculation log
    const calculationLog = this.createCalculationLog(
      elementResults, bonusResults, penaltyResults, totalScore
    );
    
    return {
      matchId,
      allianceId,
      scoreConfigVersionId: configVersion.id,
      elementScores: elementResults,
      bonusesEarned: bonusResults,
      penaltiesIncurred: penaltyResults,
      totalScore,
      calculationLog,
      timestamp: new Date()
    };
  }

  async persistCalculatedScores(result: ScoreCalculationResult): Promise<void> {
    await this.prisma.$transaction(async (prisma) => {
      // Delete existing scores for this match/alliance
      await prisma.matchScore.deleteMany({
        where: {
          matchId: result.matchId,
          allianceId: result.allianceId
        }
      });

      // Insert new element scores
      if (result.elementScores.length > 0) {
        await prisma.matchScore.createMany({
          data: result.elementScores.map(score => ({
            matchId: result.matchId,
            allianceId: result.allianceId,
            scoreElementId: score.elementId,
            units: score.units,
            totalPoints: score.totalPoints
          }))
        });
      }

      // Update alliance totals
      const autoScore = this.extractCategoryScore(result.elementScores, 'auto');
      const teleopScore = this.extractCategoryScore(result.elementScores, 'teleop');

      await prisma.alliance.update({
        where: { id: result.allianceId },
        data: {
          autoScore,
          driveScore: teleopScore, // Map teleop to driveScore for compatibility
          score: result.totalScore
        }
      });

      // Store calculation metadata
      await prisma.matchCalculation.upsert({
        where: {
          matchId_allianceId: {
            matchId: result.matchId,
            allianceId: result.allianceId
          }
        },
        create: {
          matchId: result.matchId,
          allianceId: result.allianceId,
          scoreConfigVersionId: result.scoreConfigVersionId,
          calculationLog: result.calculationLog,
          totalScore: result.totalScore,
          calculatedAt: result.timestamp
        },
        update: {
          scoreConfigVersionId: result.scoreConfigVersionId,
          calculationLog: result.calculationLog,
          totalScore: result.totalScore,
          calculatedAt: result.timestamp
        }
      });
    });
  }

  async calculateAndPersistMatchScore(
    matchId: string,
    allianceId: string,
    elementScores: Record<string, number>,
    scoreConfigVersionId?: string
  ): Promise<ScoreCalculationResult> {
    const result = await this.calculateMatchScore(
      matchId, allianceId, elementScores, scoreConfigVersionId
    );
    
    await this.persistCalculatedScores(result);
    
    return result;
  }

  // Private helper methods
  private async getMatchWithTournament(matchId: string) {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        stage: {
          include: {
            tournament: {
              include: {
                scoreConfig: true
              }
            }
          }
        }
      }
    });

    if (!match) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    return match;
  }

  private async getScoreConfigVersion(versionId?: string, fallbackConfigId?: string) {
    if (versionId) {
      const version = await this.prisma.scoreConfigVersion.findUnique({
        where: { id: versionId }
      });
      
      if (version) return version;
    }

    if (fallbackConfigId) {
      // Get latest published version
      const latestVersion = await this.prisma.scoreConfigVersion.findFirst({
        where: { scoreConfigId: fallbackConfigId },
        orderBy: { version: 'desc' }
      });
      
      if (latestVersion) return latestVersion;
    }

    throw new NotFoundException('No score configuration version found');
  }

  private extractCategoryScore(elementScores: ElementScore[], category: string): number {
    return elementScores
      .filter(score => score.category === category)
      .reduce((sum, score) => sum + score.totalPoints, 0);
  }

  // Additional helper methods...
}
```

#### 1.2.2 Add Match Calculation Model
**File:** Add to `prisma/schema.prisma`

```prisma
model MatchCalculation {
  id                    String              @id @default(uuid())
  matchId               String
  allianceId            String
  scoreConfigVersionId  String
  calculationLog        Json
  totalScore            Int
  calculatedAt          DateTime
  createdAt             DateTime            @default(now())
  
  match                 Match               @relation(fields: [matchId], references: [id], onDelete: Cascade)
  alliance              Alliance            @relation(fields: [allianceId], references: [id], onDelete: Cascade)
  scoreConfigVersion    ScoreConfigVersion  @relation(fields: [scoreConfigVersionId], references: [id])
  
  @@unique([matchId, allianceId])
  @@index([matchId])
  @@index([allianceId])
  @@index([scoreConfigVersionId])
}
```

### Step 1.3: Create Profile Versioning Service

#### 1.3.1 Score Config Versioning Service
**File:** `src/score-config/services/score-config-versioning.service.ts`

```typescript
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ScoreConfigVersioningService {
  constructor(private prisma: PrismaService) {}

  async publishScoreConfig(scoreConfigId: string, userId: string): Promise<any> {
    return this.prisma.$transaction(async (prisma) => {
      // Get current config
      const config = await prisma.scoreConfig.findUnique({
        where: { id: scoreConfigId },
        include: {
          scoreElements: true,
          bonusConditions: true,
          penaltyConditions: true
        }
      });

      if (!config) {
        throw new BadRequestException('Score config not found');
      }

      if (config.isLocked) {
        throw new ForbiddenException('Cannot publish locked score config');
      }

      // Create immutable snapshot
      const configSnapshot = {
        name: config.name,
        description: config.description,
        scoreElements: config.scoreElements,
        bonusConditions: config.bonusConditions,
        penaltyConditions: config.penaltyConditions
      };

      // Create version
      const version = await prisma.scoreConfigVersion.create({
        data: {
          scoreConfigId,
          version: config.version,
          configSnapshot,
          createdBy: userId
        }
      });

      // Update config status
      await prisma.scoreConfig.update({
        where: { id: scoreConfigId },
        data: {
          status: 'published',
          publishedAt: new Date(),
          version: { increment: 1 }
        }
      });

      // Log audit
      await this.createAuditLog(scoreConfigId, 'PUBLISH', null, { version: version.version }, userId);

      return version;
    });
  }

  async lockScoreConfig(scoreConfigId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (prisma) => {
      const config = await prisma.scoreConfig.findUnique({
        where: { id: scoreConfigId }
      });

      if (!config) {
        throw new BadRequestException('Score config not found');
      }

      if (config.isLocked) {
        throw new BadRequestException('Score config is already locked');
      }

      await prisma.scoreConfig.update({
        where: { id: scoreConfigId },
        data: {
          isLocked: true,
          lockedAt: new Date()
        }
      });

      await this.createAuditLog(scoreConfigId, 'LOCK', { isLocked: false }, { isLocked: true }, userId);
    });
  }

  private async createAuditLog(
    scoreConfigId: string,
    action: string,
    oldValues: any,
    newValues: any,
    userId: string
  ): Promise<void> {
    await this.prisma.scoreConfigAudit.create({
      data: {
        scoreConfigId,
        action,
        oldValues,
        newValues,
        userId
      }
    });
  }
}
```

### Step 1.4: Update Tournament Service for Profile Assignment

#### 1.4.1 Enhanced Tournament Service
**File:** `src/tournaments/tournaments.service.ts` (add methods)

```typescript
// Add these methods to existing TournamentsService

async assignScoreConfig(tournamentId: string, scoreConfigId: string, userId: string): Promise<any> {
  return this.prisma.$transaction(async (prisma) => {
    // Validate tournament exists
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        stages: {
          include: {
            matches: {
              where: { status: { in: ['IN_PROGRESS', 'COMPLETED'] } }
            }
          }
        }
      }
    });

    if (!tournament) {
      throw new BadRequestException('Tournament not found');
    }

    // Check if tournament has active matches
    const hasActiveMatches = tournament.stages.some(stage => 
      stage.matches.some(match => ['IN_PROGRESS', 'COMPLETED'].includes(match.status))
    );

    if (hasActiveMatches && tournament.scoreConfigId !== scoreConfigId) {
      throw new BadRequestException(
        'Cannot change score configuration after matches have started'
      );
    }

    // Validate score config exists and is published
    const scoreConfig = await prisma.scoreConfig.findUnique({
      where: { id: scoreConfigId }
    });

    if (!scoreConfig) {
      throw new BadRequestException('Score config not found');
    }

    if (scoreConfig.status !== 'published') {
      throw new BadRequestException('Can only assign published score configurations');
    }

    // Get latest version
    const latestVersion = await prisma.scoreConfigVersion.findFirst({
      where: { scoreConfigId },
      orderBy: { version: 'desc' }
    });

    if (!latestVersion) {
      throw new BadRequestException('No published version found for score config');
    }

    // Update tournament
    const updatedTournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: { scoreConfigId }
    });

    // Update pending matches to use this version
    await prisma.match.updateMany({
      where: {
        stage: { tournamentId },
        status: 'PENDING',
        scoreConfigVersionId: null
      },
      data: {
        scoreConfigVersionId: latestVersion.id
      }
    });

    // Create audit log
    await prisma.scoreConfigAudit.create({
      data: {
        scoreConfigId,
        action: 'ASSIGN_TO_TOURNAMENT',
        newValues: { tournamentId, tournamentName: tournament.name },
        userId
      }
    });

    return {
      tournament: updatedTournament,
      scoreConfigVersion: latestVersion
    };
  });
}

async findOneWithScoreConfig(tournamentId: string): Promise<any> {
  return this.prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      scoreConfig: {
        include: {
          scoreElements: { orderBy: { displayOrder: 'asc' } },
          bonusConditions: { orderBy: { displayOrder: 'asc' } },
          penaltyConditions: { orderBy: { displayOrder: 'asc' } },
          versions: {
            orderBy: { version: 'desc' },
            take: 1
          }
        }
      }
    }
  });
}

async getTournamentScoreProfile(tournamentId: string): Promise<any> {
  const tournament = await this.findOneWithScoreConfig(tournamentId);
  
  if (!tournament.scoreConfig) {
    throw new NotFoundException('No score configuration assigned to this tournament');
  }

  const latestVersion = tournament.scoreConfig.versions[0];
  
  return {
    config: tournament.scoreConfig,
    version: latestVersion,
    profile: latestVersion?.configSnapshot || {
      scoreElements: tournament.scoreConfig.scoreElements,
      bonusConditions: tournament.scoreConfig.bonusConditions,
      penaltyConditions: tournament.scoreConfig.penaltyConditions
    }
  };
}
```

---

## Phase 2: Core Integration (Week 3-4)

### Step 2.1: Update Score Config Controller

#### 2.1.1 Enhanced Controller with Versioning
**File:** `src/score-config/score-config.controller.ts`

```typescript
// Add these endpoints to existing ScoreConfigController

@Post(':id/publish')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Publish score configuration to create immutable version' })
async publishScoreConfig(
  @Param('id') id: string,
  @Request() req: any
) {
  return this.scoreConfigVersioningService.publishScoreConfig(id, req.user.id);
}

@Post(':id/lock')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Lock score configuration to prevent changes' })
async lockScoreConfig(
  @Param('id') id: string,
  @Request() req: any
) {
  await this.scoreConfigVersioningService.lockScoreConfig(id, req.user.id);
  return { message: 'Score configuration locked successfully' };
}

@Get(':id/versions')
@ApiOperation({ summary: 'Get all versions of a score configuration' })
async getVersions(@Param('id') id: string) {
  return this.prisma.scoreConfigVersion.findMany({
    where: { scoreConfigId: id },
    orderBy: { version: 'desc' },
    include: {
      creator: {
        select: { id: true, username: true }
      }
    }
  });
}

@Get(':id/audit-log')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Get audit log for score configuration' })
async getAuditLog(@Param('id') id: string) {
  return this.prisma.scoreConfigAudit.findMany({
    where: { scoreConfigId: id },
    orderBy: { timestamp: 'desc' },
    include: {
      user: {
        select: { id: true, username: true }
      }
    }
  });
}

@Post(':id/clone')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Clone score configuration' })
async cloneScoreConfig(
  @Param('id') id: string,
  @Body() data: { name: string; description?: string },
  @Request() req: any
) {
  return this.scoreConfigService.cloneScoreConfig(id, data, req.user.id);
}

@Post('calculate-preview')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Preview score calculation without persisting' })
async previewCalculation(
  @Body() data: {
    scoreConfigId: string;
    elementScores: Record<string, number>;
    sampleMatchData?: any;
  }
) {
  return this.scoreCalculationService.previewCalculation(
    data.scoreConfigId,
    data.elementScores,
    data.sampleMatchData
  );
}
```

### Step 2.2: Tournament Controller Updates

#### 2.2.1 Add Tournament-Profile Endpoints
**File:** `src/tournaments/tournaments.controller.ts`

```typescript
// Add these endpoints to existing TournamentsController

@Get(':id/score-profile')
@ApiOperation({ summary: 'Get tournament score profile for UI rendering' })
async getTournamentScoreProfile(@Param('id') id: string) {
  return this.tournamentsService.getTournamentScoreProfile(id);
}

@Post(':id/assign-score-config/:configId')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Assign score configuration to tournament' })
async assignScoreConfig(
  @Param('id') tournamentId: string,
  @Param('configId') scoreConfigId: string,
  @Request() req: any
) {
  return this.tournamentsService.assignScoreConfig(tournamentId, scoreConfigId, req.user.id);
}

@Delete(':id/score-config')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Unassign score configuration from tournament' })
async unassignScoreConfig(
  @Param('id') tournamentId: string,
  @Request() req: any
) {
  return this.tournamentsService.unassignScoreConfig(tournamentId, req.user.id);
}

@Get(':id/score-profile/preview')
@ApiOperation({ summary: 'Preview score profile with sample data' })
async previewScoreProfile(
  @Param('id') tournamentId: string,
  @Query('sampleData') sampleData?: string
) {
  const profile = await this.tournamentsService.getTournamentScoreProfile(tournamentId);
  const sample = sampleData ? JSON.parse(sampleData) : this.generateSampleData(profile);
  
  return {
    profile,
    preview: await this.scoreCalculationService.previewCalculation(
      profile.config.id,
      sample.elementScores,
      sample
    )
  };
}
```

### Step 2.3: Update Match Creation Logic

#### 2.3.1 Enhanced Matches Service
**File:** `src/matches/matches.service.ts`

```typescript
// Update create method in existing MatchesService
async create(createMatchDto: CreateMatchDto) {
  // Get stage with tournament and score config
  const stage = await this.prisma.stage.findUnique({
    where: { id: createMatchDto.stageId },
    include: {
      tournament: {
        include: {
          scoreConfig: {
            include: {
              versions: {
                where: { version: { gte: 1 } },
                orderBy: { version: 'desc' },
                take: 1
              }
            }
          }
        }
      }
    }
  });

  if (!stage) {
    throw new NotFoundException('Stage not found');
  }

  // Get latest score config version if tournament has one
  let scoreConfigVersionId = null;
  if (stage.tournament.scoreConfig) {
    const latestVersion = stage.tournament.scoreConfig.versions[0];
    if (latestVersion) {
      scoreConfigVersionId = latestVersion.id;
    }
  }

  // Create match with inherited score config version
  return this.prisma.match.create({
    data: {
      ...createMatchDto,
      scoreConfigVersionId
    },
    include: {
      scoreConfigVersion: {
        include: {
          scoreConfig: true
        }
      }
    }
  });
}

async getMatchWithScoreProfile(matchId: string) {
  return this.prisma.match.findUnique({
    where: { id: matchId },
    include: {
      scoreConfigVersion: {
        include: {
          scoreConfig: {
            include: {
              scoreElements: { orderBy: { displayOrder: 'asc' } },
              bonusConditions: { orderBy: { displayOrder: 'asc' } },
              penaltyConditions: { orderBy: { displayOrder: 'asc' } }
            }
          }
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
    }
  });
}
```

### Step 2.4: WebSocket Integration

#### 2.4.1 Update Events Gateway
**File:** `src/websockets/events.gateway.ts`

```typescript
// Add these methods to existing EventsGateway

@SubscribeMessage('profile_score_update')
async handleProfileScoreUpdate(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: ProfileScoreUpdateDto
): Promise<WsResponse<any>> {
  this.logger.log(`Profile-based score update: ${JSON.stringify(payload)}`);

  try {
    // Calculate scores using profile
    const result = await this.scoreCalculationService.calculateAndPersistMatchScore(
      payload.matchId,
      payload.allianceId,
      payload.elementScores,
      payload.scoreConfigVersionId
    );

    // Broadcast to relevant rooms
    const broadcastData = {
      type: 'profile_score_update',
      matchId: payload.matchId,
      allianceId: payload.allianceId,
      scores: result.elementScores,
      totalScore: result.totalScore,
      timestamp: result.timestamp,
      scoreConfigVersionId: result.scoreConfigVersionId
    };

    if (payload.fieldId) {
      this.emitToField(payload.fieldId, 'score_update', broadcastData);
    }
    
    if (payload.tournamentId) {
      this.server.to(payload.tournamentId).emit('score_update', broadcastData);
    }

    return {
      event: 'score_calculation_result',
      data: {
        success: true,
        result: result,
        timestamp: Date.now()
      }
    };

  } catch (error) {
    this.logger.error(`Profile score calculation failed:`, error);
    return {
      event: 'score_calculation_error',
      data: {
        success: false,
        error: error.message,
        timestamp: Date.now()
      }
    };
  }
}

@SubscribeMessage('get_match_score_profile')
async handleGetMatchScoreProfile(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: { matchId: string }
): Promise<WsResponse<any>> {
  try {
    const match = await this.matchesService.getMatchWithScoreProfile(payload.matchId);
    
    return {
      event: 'match_score_profile',
      data: {
        matchId: payload.matchId,
        profile: match.scoreConfigVersion?.configSnapshot,
        elements: match.scoreConfigVersion?.configSnapshot?.scoreElements || [],
        bonusConditions: match.scoreConfigVersion?.configSnapshot?.bonusConditions || [],
        penaltyConditions: match.scoreConfigVersion?.configSnapshot?.penaltyConditions || []
      }
    };
  } catch (error) {
    return {
      event: 'error',
      data: { message: error.message }
    };
  }
}
```

#### 2.4.2 Create Profile Score Update DTO
**File:** `src/websockets/dto/profile-score-update.dto.ts`

```typescript
import { IsString, IsObject, IsOptional } from 'class-validator';

export class ProfileScoreUpdateDto {
  @IsString()
  matchId: string;

  @IsString()
  allianceId: string;

  @IsString()
  tournamentId: string;

  @IsString()
  @IsOptional()
  fieldId?: string;

  @IsString()
  @IsOptional()
  scoreConfigVersionId?: string;

  @IsObject()
  elementScores: Record<string, number>;

  @IsString()
  @IsOptional()
  submittedBy?: string;
}
```

---

## Phase 3: Frontend Integration Support (Week 5-6)

### Step 3.1: Control Panel API Endpoints

#### 3.1.1 Match Control Controller
**File:** `src/matches/match-control.controller.ts` (new file)

```typescript
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../utils/prisma-types';

@ApiTags('match-control')
@Controller('match-control')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MatchControlController {
  constructor(
    private matchesService: MatchesService,
    private scoreCalculationService: ScoreCalculationService
  ) {}

  @Get(':matchId/score-profile')
  @ApiOperation({ summary: 'Get score profile for match control UI' })
  async getMatchScoreProfile(@Param('matchId') matchId: string) {
    const match = await this.matchesService.getMatchWithScoreProfile(matchId);
    
    if (!match.scoreConfigVersion) {
      throw new NotFoundException('No score profile assigned to this match');
    }

    const profile = match.scoreConfigVersion.configSnapshot;
    
    return {
      matchId,
      scoreConfigVersionId: match.scoreConfigVersionId,
      profile: {
        name: profile.name,
        description: profile.description,
        scoreElements: profile.scoreElements.map(element => ({
          id: element.id,
          code: element.code,
          name: element.name,
          description: element.description,
          elementType: element.elementType,
          pointsPerUnit: element.pointsPerUnit,
          category: element.category,
          displayOrder: element.displayOrder,
          icon: element.icon,
          color: element.color
        })),
        bonusConditions: profile.bonusConditions.map(bonus => ({
          id: bonus.id,
          code: bonus.code,
          name: bonus.name,
          description: bonus.description,
          bonusPoints: bonus.bonusPoints,
          condition: bonus.condition,
          displayOrder: bonus.displayOrder
        })),
        penaltyConditions: profile.penaltyConditions.map(penalty => ({
          id: penalty.id,
          code: penalty.code,
          name: penalty.name,
          description: penalty.description,
          penaltyPoints: penalty.penaltyPoints,
          condition: penalty.condition,
          displayOrder: penalty.displayOrder
        }))
      }
    };
  }

  @Get(':matchId/current-scores')
  @ApiOperation({ summary: 'Get current scores for match' })
  async getCurrentScores(@Param('matchId') matchId: string) {
    return this.matchesService.getMatchScores(matchId);
  }

  @Post(':matchId/calculate-preview')
  @Roles(UserRole.ADMIN, UserRole.HEAD_REFEREE, UserRole.ALLIANCE_REFEREE)
  @ApiOperation({ summary: 'Preview score calculation without saving' })
  async previewScoreCalculation(
    @Param('matchId') matchId: string,
    @Body() data: {
      allianceId: string;
      elementScores: Record<string, number>;
    }
  ) {
    return this.scoreCalculationService.calculateMatchScore(
      matchId,
      data.allianceId,
      data.elementScores
    );
  }

  @Post(':matchId/submit-scores')
  @Roles(UserRole.ADMIN, UserRole.HEAD_REFEREE, UserRole.ALLIANCE_REFEREE)
  @ApiOperation({ summary: 'Submit and save match scores' })
  async submitScores(
    @Param('matchId') matchId: string,
    @Body() data: {
      allianceId: string;
      elementScores: Record<string, number>;
    }
  ) {
    return this.scoreCalculationService.calculateAndPersistMatchScore(
      matchId,
      data.allianceId,
      data.elementScores
    );
  }
}
```

### Step 3.2: Audience Display API

#### 3.2.1 Audience Display Controller
**File:** `src/tournaments/audience-display.controller.ts` (new file)

```typescript
@ApiTags('audience-display')
@Controller('audience-display')
export class AudienceDisplayController {
  constructor(
    private tournamentsService: TournamentsService,
    private matchesService: MatchesService
  ) {}

  @Get('tournament/:tournamentId/display-config')
  @ApiOperation({ summary: 'Get display configuration for tournament' })
  async getTournamentDisplayConfig(@Param('tournamentId') tournamentId: string) {
    const profile = await this.tournamentsService.getTournamentScoreProfile(tournamentId);
    
    return {
      tournamentId,
      displayConfig: {
        scoreElements: profile.profile.scoreElements.map(element => ({
          code: element.code,
          name: element.name,
          category: element.category,
          icon: element.icon,
          color: element.color,
          displayOrder: element.displayOrder
        })),
        layout: this.generateDisplayLayout(profile.profile),
        periods: this.extractPeriods(profile.profile)
      }
    };
  }

  @Get('match/:matchId/display-data')
  @ApiOperation({ summary: 'Get live display data for match' })
  async getMatchDisplayData(@Param('matchId') matchId: string) {
    const match = await this.matchesService.getMatchWithScoreProfile(matchId);
    const scores = await this.matchesService.getMatchScores(matchId);
    
    return {
      matchId,
      matchNumber: match.matchNumber,
      status: match.status,
      alliances: scores.alliances,
      totalScores: {
        red: scores.red.totalScore,
        blue: scores.blue.totalScore
      },
      elementBreakdown: {
        red: scores.red.elementScores,
        blue: scores.blue.elementScores
      },
      profile: match.scoreConfigVersion?.configSnapshot
    };
  }

  private generateDisplayLayout(profile: any) {
    // Generate responsive layout configuration based on score elements
    const categories = [...new Set(profile.scoreElements.map(e => e.category))];
    
    return {
      sections: categories.map(category => ({
        title: category || 'General',
        elements: profile.scoreElements.filter(e => e.category === category)
      })),
      showBonuses: profile.bonusConditions.length > 0,
      showPenalties: profile.penaltyConditions.length > 0
    };
  }

  private extractPeriods(profile: any): string[] {
    const periods = new Set<string>();
    profile.scoreElements.forEach(element => {
      if (element.category) {
        periods.add(element.category);
      }
    });
    return Array.from(periods);
  }
}
```

---

## Phase 4: Security & Validation (Week 7)

### Step 4.1: Formula Security Enhancement

#### 4.1.1 Safe Formula Evaluator
**File:** `src/score-config/services/safe-formula-evaluator.service.ts`

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';

interface FormulaContext {
  elementScores: Record<string, number>;
  matchState: {
    period: string;
    timeRemaining: number;
    matchNumber: number;
  };
  allianceState: {
    teamCount: number;
    penalties: number;
  };
}

@Injectable()
export class SafeFormulaEvaluatorService {
  private readonly allowedFunctions = new Set([
    'min', 'max', 'abs', 'floor', 'ceil', 'round',
    'sum', 'avg', 'count', 'if', 'clamp'
  ]);

  private readonly maxExecutionTime = 1000; // 1 second
  private readonly maxMemory = 1024 * 1024; // 1MB

  evaluate(expression: string, context: FormulaContext): number {
    try {
      // Validate expression safety
      this.validateExpression(expression);
      
      // Parse and compile expression
      const compiledFunction = this.compileExpression(expression);
      
      // Execute with timeout and memory limits
      return this.executeWithLimits(compiledFunction, context);
    } catch (error) {
      throw new BadRequestException(`Formula evaluation failed: ${error.message}`);
    }
  }

  private validateExpression(expression: string): void {
    // Check for dangerous patterns
    const dangerousPatterns = [
      /eval\s*\(/i,
      /function\s*\(/i,
      /new\s+Function/i,
      /import\s*\(/i,
      /require\s*\(/i,
      /__proto__/i,
      /constructor/i,
      /prototype/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(expression)) {
        throw new Error(`Dangerous pattern detected: ${pattern}`);
      }
    }

    // Validate function calls
    const functionCalls = expression.match(/(\w+)\s*\(/g) || [];
    for (const call of functionCalls) {
      const funcName = call.replace(/\s*\($/, '');
      if (!this.allowedFunctions.has(funcName)) {
        throw new Error(`Function not allowed: ${funcName}`);
      }
    }

    // Check expression length
    if (expression.length > 1000) {
      throw new Error('Expression too long');
    }
  }

  private compileExpression(expression: string): Function {
    // Create safe function context
    const safeContext = {
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
      avg: (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length,
      count: (arr: any[]) => arr.length,
      if: (condition: boolean, trueVal: number, falseVal: number) => condition ? trueVal : falseVal,
      clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
    };

    // Wrap expression in a safe function
    const wrappedExpression = `
      "use strict";
      return (${expression});
    `;

    try {
      return new Function('context', 'helpers', wrappedExpression);
    } catch (error) {
      throw new Error(`Failed to compile expression: ${error.message}`);
    }
  }

  private executeWithLimits(func: Function, context: FormulaContext): number {
    const startTime = Date.now();
    let result: number;

    // Execute with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Execution timeout')), this.maxExecutionTime);
    });

    const executionPromise = new Promise<number>((resolve) => {
      try {
        result = func(context, {});
        resolve(result);
      } catch (error) {
        throw new Error(`Execution error: ${error.message}`);
      }
    });

    // Wait for either completion or timeout
    return Promise.race([executionPromise, timeoutPromise])
      .then(result => {
        // Validate result
        if (typeof result !== 'number' || !isFinite(result)) {
          throw new Error('Formula must return a finite number');
        }
        return Math.round(result * 100) / 100; // Round to 2 decimal places
      })
      .catch(error => {
        throw new BadRequestException(`Formula execution failed: ${error.message}`);
      });
  }
}
```

### Step 4.2: Input Validation Enhancement

#### 4.2.1 Score Config Validation Service
**File:** `src/score-config/services/score-config-validation.service.ts`

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateScoreConfigDto } from '../dto/create-score-config.dto';

@Injectable()
export class ScoreConfigValidationService {
  validateScoreConfig(config: CreateScoreConfigDto): ValidationResult {
    const errors: string[] = [];

    // Validate score elements
    if (config.scoreElements) {
      errors.push(...this.validateScoreElements(config.scoreElements));
    }

    // Validate bonus conditions
    if (config.bonusConditions) {
      errors.push(...this.validateBonusConditions(config.bonusConditions));
    }

    // Validate penalty conditions
    if (config.penaltyConditions) {
      errors.push(...this.validatePenaltyConditions(config.penaltyConditions));
    }

    // Cross-validation
    errors.push(...this.validateCrossReferences(config));

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private validateScoreElements(elements: any[]): string[] {
    const errors: string[] = [];
    const codes = new Set<string>();

    elements.forEach((element, index) => {
      // Check for duplicate codes
      if (codes.has(element.code)) {
        errors.push(`Duplicate score element code: ${element.code}`);
      }
      codes.add(element.code);

      // Validate point values
      if (Math.abs(element.pointsPerUnit) > 1000) {
        errors.push(`Score element ${element.code}: pointsPerUnit too large`);
      }

      // Validate element type
      if (!['COUNTER', 'BOOLEAN', 'TIMER'].includes(element.elementType)) {
        errors.push(`Score element ${element.code}: invalid elementType`);
      }

      // Validate display order
      if (element.displayOrder < 0) {
        errors.push(`Score element ${element.code}: displayOrder must be >= 0`);
      }
    });

    return errors;
  }

  private validateBonusConditions(conditions: any[]): string[] {
    const errors: string[] = [];
    const codes = new Set<string>();

    conditions.forEach((condition, index) => {
      // Check for duplicate codes
      if (codes.has(condition.code)) {
        errors.push(`Duplicate bonus condition code: ${condition.code}`);
      }
      codes.add(condition.code);

      // Validate points
      if (condition.bonusPoints <= 0) {
        errors.push(`Bonus condition ${condition.code}: bonusPoints must be positive`);
      }

      if (condition.bonusPoints > 1000) {
        errors.push(`Bonus condition ${condition.code}: bonusPoints too large`);
      }

      // Validate condition structure
      errors.push(...this.validateConditionStructure(condition.condition, `bonus ${condition.code}`));
    });

    return errors;
  }

  private validatePenaltyConditions(conditions: any[]): string[] {
    const errors: string[] = [];
    const codes = new Set<string>();

    conditions.forEach((condition, index) => {
      // Check for duplicate codes
      if (codes.has(condition.code)) {
        errors.push(`Duplicate penalty condition code: ${condition.code}`);
      }
      codes.add(condition.code);

      // Validate points (should be negative)
      if (condition.penaltyPoints >= 0) {
        errors.push(`Penalty condition ${condition.code}: penaltyPoints should be negative`);
      }

      if (condition.penaltyPoints < -1000) {
        errors.push(`Penalty condition ${condition.code}: penaltyPoints too large`);
      }

      // Validate condition structure
      errors.push(...this.validateConditionStructure(condition.condition, `penalty ${condition.code}`));
    });

    return errors;
  }

  private validateConditionStructure(condition: any, context: string): string[] {
    const errors: string[] = [];

    if (!condition || typeof condition !== 'object') {
      errors.push(`${context}: condition must be an object`);
      return errors;
    }

    if (!condition.type) {
      errors.push(`${context}: condition must have a type`);
      return errors;
    }

    switch (condition.type) {
      case 'threshold':
        if (!condition.elementCode) {
          errors.push(`${context}: threshold condition must have elementCode`);
        }
        if (!condition.operator || !['==', '!=', '>', '>=', '<', '<='].includes(condition.operator)) {
          errors.push(`${context}: invalid threshold operator`);
        }
        if (typeof condition.value !== 'number') {
          errors.push(`${context}: threshold value must be a number`);
        }
        break;

      case 'composite':
        if (!condition.operator || !['AND', 'OR'].includes(condition.operator)) {
          errors.push(`${context}: invalid composite operator`);
        }
        if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) {
          errors.push(`${context}: composite condition must have sub-conditions`);
        } else {
          // Check for circular references and depth
          errors.push(...this.validateCompositeDepth(condition, context, 0));
        }
        break;

      default:
        errors.push(`${context}: unknown condition type ${condition.type}`);
    }

    return errors;
  }

  private validateCompositeDepth(condition: any, context: string, depth: number): string[] {
    const errors: string[] = [];

    if (depth > 5) {
      errors.push(`${context}: condition nesting too deep (max 5 levels)`);
      return errors;
    }

    if (condition.type === 'composite' && condition.conditions) {
      for (const subCondition of condition.conditions) {
        errors.push(...this.validateConditionStructure(subCondition, context));
        if (subCondition.type === 'composite') {
          errors.push(...this.validateCompositeDepth(subCondition, context, depth + 1));
        }
      }
    }

    return errors;
  }

  private validateCrossReferences(config: CreateScoreConfigDto): string[] {
    const errors: string[] = [];
    const elementCodes = new Set(config.scoreElements?.map(e => e.code) || []);

    // Check that all condition references exist
    const checkElementReference = (condition: any, context: string) => {
      if (condition.type === 'threshold' && condition.elementCode) {
        if (!elementCodes.has(condition.elementCode)) {
          errors.push(`${context}: references unknown element ${condition.elementCode}`);
        }
      } else if (condition.type === 'composite' && condition.conditions) {
        condition.conditions.forEach((sub: any, index: number) => {
          checkElementReference(sub, `${context}.conditions[${index}]`);
        });
      }
    };

    config.bonusConditions?.forEach((bonus, index) => {
      checkElementReference(bonus.condition, `bonusConditions[${index}]`);
    });

    config.penaltyConditions?.forEach((penalty, index) => {
      checkElementReference(penalty.condition, `penaltyConditions[${index}]`);
    });

    return errors;
  }
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}
```

---

## Phase 5: Testing & Documentation (Week 8)

### Step 5.1: Unit Tests

#### 5.1.1 Score Calculation Service Tests
**File:** `src/score-config/score-calculation.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ScoreCalculationService } from './score-calculation.service';
import { PrismaService } from '../prisma.service';
import { ConditionEvaluatorFactory } from './strategies/condition-evaluator.factory';

describe('ScoreCalculationService', () => {
  let service: ScoreCalculationService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScoreCalculationService,
        {
          provide: PrismaService,
          useValue: {
            match: { findUnique: jest.fn() },
            alliance: { findUnique: jest.fn(), update: jest.fn() },
            scoreConfigVersion: { findUnique: jest.fn(), findFirst: jest.fn() },
            matchScore: { deleteMany: jest.fn(), createMany: jest.fn() },
            matchCalculation: { upsert: jest.fn() },
            $transaction: jest.fn((callback) => callback(prisma))
          }
        },
        {
          provide: ConditionEvaluatorFactory,
          useValue: {
            createEvaluator: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<ScoreCalculationService>(ScoreCalculationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('calculateMatchScore', () => {
    it('should calculate basic element scores', async () => {
      // Mock data setup
      const mockMatch = {
        id: 'match-1',
        stage: {
          tournament: {
            id: 'tournament-1',
            scoreConfigId: 'config-1'
          }
        }
      };

      const mockConfigVersion = {
        id: 'version-1',
        configSnapshot: {
          scoreElements: [
            {
              id: 'element-1',
              code: 'auto_balls',
              name: 'Auto Balls',
              pointsPerUnit: 2,
              category: 'auto'
            }
          ],
          bonusConditions: [],
          penaltyConditions: []
        }
      };

      jest.spyOn(prisma.match, 'findUnique').mockResolvedValue(mockMatch as any);
      jest.spyOn(prisma.alliance, 'findUnique').mockResolvedValue({ id: 'alliance-1' } as any);
      jest.spyOn(prisma.scoreConfigVersion, 'findFirst').mockResolvedValue(mockConfigVersion as any);

      const result = await service.calculateMatchScore(
        'match-1',
        'alliance-1',
        { auto_balls: 5 }
      );

      expect(result.totalScore).toBe(10); // 5 balls * 2 points
      expect(result.elementScores).toHaveLength(1);
      expect(result.elementScores[0].totalPoints).toBe(10);
    });

    it('should handle bonus conditions', async () => {
      const mockConfigVersion = {
        id: 'version-1',
        configSnapshot: {
          scoreElements: [
            { id: 'element-1', code: 'balls', name: 'Balls', pointsPerUnit: 2, category: 'teleop' }
          ],
          bonusConditions: [
            {
              id: 'bonus-1',
              code: 'high_score',
              name: 'High Score Bonus',
              bonusPoints: 10,
              condition: {
                type: 'threshold',
                elementCode: 'balls',
                operator: '>=',
                value: 10
              }
            }
          ],
          penaltyConditions: []
        }
      };

      const mockEvaluator = {
        evaluate: jest.fn().mockReturnValue(true)
      };

      jest.spyOn(prisma.scoreConfigVersion, 'findFirst').mockResolvedValue(mockConfigVersion as any);
      jest.spyOn(service['conditionEvaluatorFactory'], 'createEvaluator').mockReturnValue(mockEvaluator);

      const result = await service.calculateMatchScore(
        'match-1',
        'alliance-1',
        { balls: 12 }
      );

      expect(result.totalScore).toBe(34); // (12 * 2) + 10 bonus
      expect(result.bonusesEarned).toHaveLength(1);
    });
  });

  describe('persistCalculatedScores', () => {
    it('should persist scores atomically', async () => {
      const result = {
        matchId: 'match-1',
        allianceId: 'alliance-1',
        scoreConfigVersionId: 'version-1',
        elementScores: [
          {
            elementId: 'element-1',
            elementCode: 'balls',
            elementName: 'Balls',
            units: 5,
            pointsPerUnit: 2,
            totalPoints: 10,
            category: 'auto'
          }
        ],
        bonusesEarned: [],
        penaltiesIncurred: [],
        totalScore: 10,
        calculationLog: {},
        timestamp: new Date()
      };

      await service.persistCalculatedScores(result);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.matchScore.deleteMany).toHaveBeenCalledWith({
        where: {
          matchId: 'match-1',
          allianceId: 'alliance-1'
        }
      });
      expect(prisma.matchScore.createMany).toHaveBeenCalled();
      expect(prisma.alliance.update).toHaveBeenCalled();
    });
  });
});
```

### Step 5.2: Integration Tests

#### 5.2.1 E2E Score Config Tests
**File:** `test/score-config.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('ScoreConfig (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let tournamentId: string;
  let scoreConfigId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get<PrismaService>(PrismaService);
    
    await app.init();

    // Create test user and get auth token
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        username: 'admin',
        password: 'password'
      });
    
    authToken = loginResponse.body.accessToken;

    // Create test tournament
    const tournamentResponse = await request(app.getHttpServer())
      .post('/tournaments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Tournament',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        adminId: 'admin-user-id',
        numberOfFields: 2
      });
    
    tournamentId = tournamentResponse.body.id;
  });

  describe('Score Config Lifecycle', () => {
    it('should create a score configuration', async () => {
      const response = await request(app.getHttpServer())
        .post('/score-configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Score Config',
          description: 'Test configuration for e2e tests',
          scoreElements: [
            {
              name: 'Auto Balls',
              code: 'auto_balls',
              description: 'Balls scored in autonomous',
              pointsPerUnit: 2,
              category: 'auto',
              elementType: 'COUNTER',
              displayOrder: 1
            },
            {
              name: 'Teleop Balls',
              code: 'teleop_balls',
              description: 'Balls scored in teleop',
              pointsPerUnit: 1,
              category: 'teleop',
              elementType: 'COUNTER',
              displayOrder: 2
            }
          ],
          bonusConditions: [
            {
              name: 'High Score Bonus',
              code: 'high_score',
              description: 'Bonus for scoring 20+ balls total',
              bonusPoints: 10,
              condition: {
                type: 'composite',
                operator: 'AND',
                conditions: [
                  {
                    type: 'threshold',
                    elementCode: 'auto_balls',
                    operator: '>=',
                    value: 5
                  },
                  {
                    type: 'threshold',
                    elementCode: 'teleop_balls',
                    operator: '>=',
                    value: 15
                  }
                ]
              },
              displayOrder: 1
            }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe('Test Score Config');
      expect(response.body.scoreElements).toHaveLength(2);
      expect(response.body.bonusConditions).toHaveLength(1);
      
      scoreConfigId = response.body.id;
    });

    it('should publish the score configuration', async () => {
      const response = await request(app.getHttpServer())
        .post(`/score-configs/${scoreConfigId}/publish`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body.version).toBe(1);
      expect(response.body.configSnapshot).toBeDefined();
    });

    it('should assign score config to tournament', async () => {
      const response = await request(app.getHttpServer())
        .post(`/tournaments/${tournamentId}/assign-score-config/${scoreConfigId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(201);
      expect(response.body.tournament.scoreConfigId).toBe(scoreConfigId);
    });

    it('should get tournament score profile', async () => {
      const response = await request(app.getHttpServer())
        .get(`/tournaments/${tournamentId}/score-profile`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.profile.scoreElements).toHaveLength(2);
      expect(response.body.profile.bonusConditions).toHaveLength(1);
    });
  });

  describe('Match Scoring', () => {
    let matchId: string;
    let allianceId: string;

    beforeEach(async () => {
      // Create stage and match for testing
      const stage = await prisma.stage.create({
        data: {
          name: 'Qualification',
          type: 'SWISS',
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          tournamentId,
          teamsPerAlliance: 2
        }
      });

      const match = await prisma.match.create({
        data: {
          matchNumber: 1,
          status: 'PENDING',
          stageId: stage.id,
          matchType: 'FULL'
        }
      });

      const alliance = await prisma.alliance.create({
        data: {
          color: 'RED',
          matchId: match.id,
          score: 0,
          autoScore: 0,
          driveScore: 0
        }
      });

      matchId = match.id;
      allianceId = alliance.id;
    });

    it('should calculate match scores using profile', async () => {
      const response = await request(app.getHttpServer())
        .post(`/score-configs/calculate/${matchId}/${allianceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          elementScores: {
            auto_balls: 8,
            teleop_balls: 15
          },
          scoreConfigId
        });

      expect(response.status).toBe(200);
      expect(response.body.totalScore).toBe(41); // (8*2) + (15*1) + 10 bonus
      expect(response.body.bonusesEarned).toHaveLength(1);
    });

    it('should persist calculated scores', async () => {
      await request(app.getHttpServer())
        .post(`/score-configs/calculate/${matchId}/${allianceId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          elementScores: {
            auto_balls: 5,
            teleop_balls: 10
          },
          scoreConfigId
        });

      // Verify scores were persisted
      const matchScores = await prisma.matchScore.findMany({
        where: {
          matchId,
          allianceId
        }
      });

      expect(matchScores).toHaveLength(2);
      
      const alliance = await prisma.alliance.findUnique({
        where: { id: allianceId }
      });

      expect(alliance.score).toBe(20); // (5*2) + (10*1)
      expect(alliance.autoScore).toBe(10);
      expect(alliance.driveScore).toBe(10);
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
```

### Step 5.3: API Documentation Updates

#### 5.3.1 Update Swagger Documentation
**File:** Update existing controllers with comprehensive API documentation

```typescript
// Add detailed Swagger documentation to all new endpoints

@ApiOperation({
  summary: 'Create score configuration with elements and conditions',
  description: `
    Creates a new score configuration that can be assigned to tournaments.
    The configuration includes:
    - Score elements: Individual scoring components (balls, penalties, etc.)
    - Bonus conditions: Rules that award bonus points when met
    - Penalty conditions: Rules that deduct points when triggered
    
    All configurations start in 'draft' status and must be published before assignment.
  `
})
@ApiResponse({
  status: 201,
  description: 'Score configuration created successfully',
  schema: {
    example: {
      id: 'uuid',
      name: 'FTC Standard Scoring',
      description: 'Standard scoring for FTC tournaments',
      status: 'draft',
      version: 1,
      scoreElements: [
        {
          id: 'uuid',
          code: 'auto_balls',
          name: 'Autonomous Balls',
          pointsPerUnit: 2,
          category: 'auto',
          elementType: 'COUNTER'
        }
      ]
    }
  }
})
@ApiBadRequestResponse({
  description: 'Validation errors in score configuration data'
})
```

---

## Phase 6: Deployment & Monitoring (Week 9)

### Step 6.1: Migration Scripts

#### 6.1.1 Safe Migration Script
**File:** `scripts/migrate-score-config.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateToScoreConfig() {
  console.log('Starting score-config migration...');

  try {
    // Create legacy score configuration
    const legacyConfig = await prisma.scoreConfig.create({
      data: {
        name: 'Legacy Scoring System',
        description: 'Maintains compatibility with existing hardcoded scoring',
        status: 'published',
        isLocked: true,
        publishedAt: new Date(),
        lockedAt: new Date(),
        scoreElements: {
          create: [
            {
              name: 'Auto Score',
              code: 'auto_score',
              description: 'Autonomous period score',
              pointsPerUnit: 1,
              category: 'auto',
              elementType: 'COUNTER',
              displayOrder: 1
            },
            {
              name: 'Teleop Score',
              code: 'teleop_score',
              description: 'Driver-controlled period score',
              pointsPerUnit: 1,
              category: 'teleop',
              elementType: 'COUNTER',
              displayOrder: 2
            }
          ]
        }
      },
      include: {
        scoreElements: true
      }
    });

    // Create legacy version
    const legacyVersion = await prisma.scoreConfigVersion.create({
      data: {
        scoreConfigId: legacyConfig.id,
        version: 1,
        configSnapshot: {
          name: legacyConfig.name,
          description: legacyConfig.description,
          scoreElements: legacyConfig.scoreElements,
          bonusConditions: [],
          penaltyConditions: []
        },
        createdBy: 'system' // Assumes system user exists
      }
    });

    // Assign legacy config to all existing tournaments
    const tournaments = await prisma.tournament.findMany({
      where: { scoreConfigId: null }
    });

    for (const tournament of tournaments) {
      await prisma.tournament.update({
        where: { id: tournament.id },
        data: { scoreConfigId: legacyConfig.id }
      });

      console.log(`Assigned legacy config to tournament: ${tournament.name}`);
    }

    // Update existing matches to use legacy version
    await prisma.match.updateMany({
      where: { scoreConfigVersionId: null },
      data: { scoreConfigVersionId: legacyVersion.id }
    });

    console.log(`Migration completed successfully:`);
    console.log(`- Created legacy config: ${legacyConfig.id}`);
    console.log(`- Created legacy version: ${legacyVersion.id}`);
    console.log(`- Updated ${tournaments.length} tournaments`);
    console.log(`- Updated matches to use legacy version`);

  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  migrateToScoreConfig()
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { migrateToScoreConfig };
```

#### 6.1.2 Data Validation Script
**File:** `scripts/validate-score-data.ts`

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function validateScoreData() {
  console.log('Validating score configuration data...');

  const validationResults = {
    tournaments: { total: 0, withConfig: 0, errors: [] },
    matches: { total: 0, withVersion: 0, errors: [] },
    scoreConfigs: { total: 0, published: 0, locked: 0, errors: [] }
  };

  try {
    // Validate tournaments
    const tournaments = await prisma.tournament.findMany({
      include: { scoreConfig: true, stages: { include: { matches: true } } }
    });

    validationResults.tournaments.total = tournaments.length;

    for (const tournament of tournaments) {
      if (tournament.scoreConfig) {
        validationResults.tournaments.withConfig++;
      } else {
        validationResults.tournaments.errors.push(
          `Tournament ${tournament.name} (${tournament.id}) has no score config`
        );
      }

      // Check if tournament has matches without score config version
      const matchesWithoutVersion = tournament.stages
        .flatMap(stage => stage.matches)
        .filter(match => !match.scoreConfigVersionId);

      if (matchesWithoutVersion.length > 0) {
        validationResults.matches.errors.push(
          `Tournament ${tournament.name} has ${matchesWithoutVersion.length} matches without score config version`
        );
      }
    }

    // Validate matches
    const matches = await prisma.match.findMany({
      include: { scoreConfigVersion: true }
    });

    validationResults.matches.total = matches.length;
    validationResults.matches.withVersion = matches.filter(m => m.scoreConfigVersionId).length;

    // Validate score configs
    const configs = await prisma.scoreConfig.findMany({
      include: {
        versions: true,
        scoreElements: true,
        _count: {
          select: { tournaments: true }
        }
      }
    });

    validationResults.scoreConfigs.total = configs.length;
    validationResults.scoreConfigs.published = configs.filter(c => c.status === 'published').length;
    validationResults.scoreConfigs.locked = configs.filter(c => c.isLocked).length;

    for (const config of configs) {
      // Check for configs without elements
      if (config.scoreElements.length === 0) {
        validationResults.scoreConfigs.errors.push(
          `Score config ${config.name} (${config.id}) has no score elements`
        );
      }

      // Check for published configs without versions
      if (config.status === 'published' && config.versions.length === 0) {
        validationResults.scoreConfigs.errors.push(
          `Published score config ${config.name} (${config.id}) has no versions`
        );
      }

      // Check for unused configs
      if (config._count.tournaments === 0) {
        console.log(`Unused score config: ${config.name} (${config.id})`);
      }
    }

    // Print results
    console.log('\n=== Validation Results ===');
    console.log(`Tournaments: ${validationResults.tournaments.withConfig}/${validationResults.tournaments.total} have score configs`);
    console.log(`Matches: ${validationResults.matches.withVersion}/${validationResults.matches.total} have score config versions`);
    console.log(`Score Configs: ${validationResults.scoreConfigs.published}/${validationResults.scoreConfigs.total} published, ${validationResults.scoreConfigs.locked} locked`);

    const totalErrors = validationResults.tournaments.errors.length +
                       validationResults.matches.errors.length +
                       validationResults.scoreConfigs.errors.length;

    if (totalErrors > 0) {
      console.log(`\n=== Errors Found (${totalErrors}) ===`);
      [...validationResults.tournaments.errors,
       ...validationResults.matches.errors,
       ...validationResults.scoreConfigs.errors].forEach(error => {
        console.log(`❌ ${error}`);
      });
    } else {
      console.log('\n✅ All validations passed!');
    }

    return validationResults;

  } catch (error) {
    console.error('Validation failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  validateScoreData()
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}

export { validateScoreData };
```

### Step 6.2: Monitoring & Observability

#### 6.2.1 Score Config Metrics
**File:** `src/score-config/services/score-config-metrics.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ScoreConfigMetricsService {
  private readonly logger = new Logger(ScoreConfigMetricsService.name);

  constructor(private prisma: PrismaService) {}

  async recordScoreCalculation(
    scoreConfigVersionId: string,
    executionTimeMs: number,
    success: boolean,
    matchId: string
  ) {
    this.logger.log({
      event: 'score_calculation',
      scoreConfigVersionId,
      executionTimeMs,
      success,
      matchId,
      timestamp: new Date().toISOString()
    });

    // In production, send to metrics service (DataDog, Prometheus, etc.)
    // await this.metricsClient.increment('score_calculations_total', {
    //   version_id: scoreConfigVersionId,
    //   success: success.toString()
    // });
    // await this.metricsClient.histogram('score_calculation_duration_ms', executionTimeMs);
  }

  async recordFormulaEvaluation(
    formula: string,
    executionTimeMs: number,
    success: boolean,
    errorType?: string
  ) {
    this.logger.log({
      event: 'formula_evaluation',
      formulaHash: this.hashFormula(formula),
      executionTimeMs,
      success,
      errorType,
      timestamp: new Date().toISOString()
    });
  }

  async getScoreConfigUsageStats() {
    const stats = await this.prisma.$queryRaw`
      SELECT 
        sc.id,
        sc.name,
        sc.status,
        COUNT(DISTINCT t.id) as tournament_count,
        COUNT(DISTINCT m.id) as match_count,
        COUNT(DISTINCT mc.id) as calculation_count
      FROM "ScoreConfig" sc
      LEFT JOIN "Tournament" t ON sc.id = t."scoreConfigId"
      LEFT JOIN "Stage" s ON t.id = s."tournamentId"
      LEFT JOIN "Match" m ON s.id = m."stageId"
      LEFT JOIN "MatchCalculation" mc ON m.id = mc."matchId"
      GROUP BY sc.id, sc.name, sc.status
      ORDER BY tournament_count DESC
    `;

    return stats;
  }

  private hashFormula(formula: string): string {
    // Simple hash for anonymizing formulas in logs
    let hash = 0;
    for (let i = 0; i < formula.length; i++) {
      const char = formula.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
```

---

## 📋 Implementation Checklist

### Phase 1: Foundation & Critical Fixes ✅
- [ ] Database schema updates with versioning
- [ ] Fix score persistence in calculation service
- [ ] Create profile versioning service
- [ ] Update tournament service for profile assignment
- [ ] Run and verify migrations

### Phase 2: Core Integration ✅
- [ ] Enhanced score config controller with versioning
- [ ] Tournament-profile endpoint creation
- [ ] Match creation logic updates
- [ ] WebSocket integration for profile-based scoring
- [ ] Profile score update DTOs

### Phase 3: Frontend Integration Support ✅
- [ ] Match control API endpoints
- [ ] Audience display API endpoints
- [ ] Dynamic profile rendering support
- [ ] Real-time score profile events

### Phase 4: Security & Validation ✅
- [ ] Safe formula evaluator implementation
- [ ] Comprehensive input validation
- [ ] Condition structure validation
- [ ] Cross-reference validation

### Phase 5: Testing & Documentation ✅
- [ ] Unit tests for all services
- [ ] Integration tests for score lifecycle
- [ ] E2E tests for complete workflows
- [ ] API documentation updates

### Phase 6: Deployment & Monitoring ✅
- [ ] Migration scripts for existing data
- [ ] Data validation scripts
- [ ] Metrics and monitoring setup
- [ ] Performance optimization

---

## 🚀 Getting Started

### Prerequisites
- PostgreSQL 12+
- Node.js 18+
- Existing RMS_BE setup

### Installation Steps

1. **Update Dependencies**
```bash
npm install class-validator class-transformer
npm install --save-dev @types/node
```

2. **Run Database Migrations**
```bash
npx prisma migrate dev --name add_score_config_versioning
npx prisma generate
```

3. **Create Migration Script**
```bash
npm run build
node dist/scripts/migrate-score-config.js
```

4. **Validate Migration**
```bash
node dist/scripts/validate-score-data.js
```

5. **Start Development Server**
```bash
npm run start:dev
```

6. **Test Implementation**
```bash
npm run test:e2e -- --testNamePattern="ScoreConfig"
```

---

## 📚 Additional Resources

### Documentation
- [Prisma Documentation](https://www.prisma.io/docs)
- [NestJS Guards](https://docs.nestjs.com/guards)
- [WebSocket Gateway](https://docs.nestjs.com/websockets/gateways)

### Best Practices
- Always use transactions for score calculations
- Validate formulas before saving configurations
- Lock configurations once tournaments start
- Maintain audit trails for all changes
- Use versioning for reproducible match results

### Monitoring
- Track formula execution times
- Monitor calculation failures
- Alert on performance degradation
- Log all configuration changes

---

## 🤝 Support

For issues with implementation:
1. Check unit tests for expected behavior
2. Review API documentation for endpoint contracts
3. Validate database schema matches expectations
4. Test with sample data using provided scripts

---

**Last Updated:** December 2024
**Version:** 1.0
**Status:** Implementation Ready
