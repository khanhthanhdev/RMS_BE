import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Schema for updating a single match time
export const UpdateMatchTimeSchema = z.object({
  scheduledTime: z.coerce.date({
    required_error: 'Scheduled time is required',
    invalid_type_error: 'Scheduled time must be a valid date'
  }),
  updateSubsequent: z.boolean().optional().default(false), // Whether to update all subsequent matches
  fieldIntervalMinutes: z.number().int().min(1).max(60).optional().default(5), // Minutes between fields
});

// Schema for bulk updating match times
export const BulkUpdateMatchTimesSchema = z.object({
  stageId: z.string().uuid('Stage ID must be a valid UUID'),
  startTime: z.coerce.date({
    required_error: 'Start time is required',
    invalid_type_error: 'Start time must be a valid date'
  }),
  matchIntervalMinutes: z.number().int().min(1).max(120).optional().default(10), // Minutes between matches on same field
  fieldIntervalMinutes: z.number().int().min(1).max(60).optional().default(5), // Minutes between fields
  resetAllTimes: z.boolean().optional().default(false), // Whether to reset all times or just pending matches
});

// Create DTO classes from the Zod schemas
export class UpdateMatchTimeDto extends createZodDto(UpdateMatchTimeSchema) {}
export class BulkUpdateMatchTimesDto extends createZodDto(BulkUpdateMatchTimesSchema) {}
