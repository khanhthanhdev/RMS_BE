import { IsInt, IsOptional, Min, Max, IsString, IsUUID, IsIn } from 'class-validator';

export class ScheduleConfigDto {
    @IsUUID()
    stageId: string;

    @IsInt()
    @Min(1)
    rounds: number;

    @IsInt()
    @Min(1)
    @Max(10)
    minMatchSeparation: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(3)
    @IsIn([1, 2, 3])
    teamsPerAlliance: number = 3;

    @IsInt()
    @Min(100)
    @Max(100000)
    @IsOptional()
    maxIterations: number = 10000;

    @IsString()
    @IsOptional()
    qualityLevel: 'low' | 'medium' | 'high' = 'medium';
}
