import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateBulkTeamsSchema = z.object({
  tournamentId: z.string().uuid('Tournament ID must be a valid UUID'),
  numberOfTeams: z.number().min(1, 'Number of teams must be at least 1').max(100, 'Maximum 100 teams allowed'),
});

export class CreateBulkTeamsDto extends createZodDto(CreateBulkTeamsSchema) {}
