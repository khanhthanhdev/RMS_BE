import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const resendVerificationDto = z.object({
  email: z.string().email('Invalid email format'),
});

export class ResendVerificationDto extends createZodDto(resendVerificationDto) {}
