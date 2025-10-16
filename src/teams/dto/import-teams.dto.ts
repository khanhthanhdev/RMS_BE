import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Schema for CSV text content with specific fields for quick team creation
export const ImportTeamsSchema = z.object({
  content: z.string().min(1, 'Content is required'),
  format: z.enum(['csv', 'text']).default('csv'),
  hasHeader: z.boolean().default(true),
  delimiter: z.string().default(','),
  tournamentId: z
    .string()
    .uuid('Invalid tournament ID format')
    .min(1, 'Tournament ID is required'),
});

// Schema for individual team data from CSV
export const TeamImportDataSchema = z.object({
  teamName: z.string().min(1, 'Team name is required'),
  email: z
    .string()
    .optional()
    .refine((val) => !val || /\S+@\S+\.\S+/.test(val), {
      message: 'Invalid email format',
    }),
  numberOfMembers: z
    .string()
    .transform((val) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 1) {
        throw new Error('Number of members must be a positive integer');
      }
      return num;
    }),
  schoolOrganization: z.string().optional(),
  location: z.string().optional(),
});

// Create a DTO class from the Zod schema
export class ImportTeamsDto extends createZodDto(ImportTeamsSchema) {}
export class TeamImportDataDto extends createZodDto(TeamImportDataSchema) {}
