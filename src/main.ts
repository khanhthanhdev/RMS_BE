declare const module: any;


import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ZodValidationPipe } from 'nestjs-zod';
import { patchNestJsSwagger } from 'nestjs-zod';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PrismaClient } from '../generated/prisma';
import { Logger } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';

/**
 * Verifies that Prisma client can be instantiated
 * @returns Promise that resolves when Prisma is verified
 */
async function verifyPrismaGenerated(): Promise<void> {
  const logger = new Logger('PrismaInit');
  
  try {
    logger.log('Verifying Prisma client initialization...');
    
    // Attempt to initialize PrismaClient
    const prisma = new PrismaClient();
    await prisma.$connect();
    logger.log('Prisma client initialized successfully');
    await prisma.$disconnect();
    
    return Promise.resolve();
  } catch (error) {
    logger.error('Failed to initialize Prisma client');
    
    if (error.message?.includes('did not initialize yet') || 
        error.message?.includes('prisma generate')) {
      logger.error('Please run "npx prisma generate" and try again');
    } else {
      logger.error(`Prisma initialization error: ${error.message}`);
    }
    
    return Promise.reject(error);
  }
}

/**
 * Parse a comma-separated environment variable into distinct origins.
 */
function parseOriginsEnv(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Escape special characters for use in a RegExp.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Convert wildcard patterns (e.g. https://*.trycloudflare.com) to RegExp.
 */
function patternToRegExp(pattern: string): RegExp {
  const escapedSegments = pattern
    .trim()
    .split('*')
    .map((segment) => escapeRegExp(segment));
  const regexBody = escapedSegments.join('.*');
  return new RegExp(`^${regexBody}$`);
}

/**
 * Bootstrap the NestJS application
 */
async function bootstrap(): Promise<void> {
  // Verify Prisma is properly generated before starting the app
  try {
    await verifyPrismaGenerated();
  } catch (error) {
    process.exit(1);
  }

  // Patch Swagger for Zod support
  patchNestJsSwagger();
  
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Enable cookie parsing for HTTP-only JWT cookies
  app.use(cookieParser());

  // Enable CORS with specific configuration for credentialed requests
  const defaultDevOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
  ];

  const configuredOrigins = [
    ...parseOriginsEnv(process.env.FRONTEND_URL),
    ...parseOriginsEnv(process.env.CORS_ALLOWED_ORIGINS),
  ];

  const configuredPatterns = parseOriginsEnv(
    process.env.CORS_ALLOWED_ORIGIN_PATTERNS,
  ).map(patternToRegExp);

  const wildcardPatterns: RegExp[] = [
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [patternToRegExp('https://*.trycloudflare.com')]),
    ...configuredPatterns,
  ];

  const corsAllowList = new Set(
    (process.env.NODE_ENV === 'production'
      ? configuredOrigins
      : [...defaultDevOrigins, ...configuredOrigins])
      .filter(Boolean),
  );

  logger.log(
    `CORS allowlist (exact): ${JSON.stringify(Array.from(corsAllowList))}`,
  );
  if (wildcardPatterns.length > 0) {
    logger.log(
      `CORS wildcard patterns: ${JSON.stringify(
        wildcardPatterns.map((pattern) => pattern.source),
      )}`,
    );
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        // Allow non-browser clients or same-origin requests
        return callback(null, true);
      }

      if (
        corsAllowList.has(origin) ||
        wildcardPatterns.some((pattern) => pattern.test(origin))
      ) {
        return callback(null, true);
      }

      logger.warn(`Blocked CORS origin: ${origin}`);
      return callback(new Error(`Origin ${origin} not allowed by CORS policy`), false);
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type,Accept,Authorization,Cookie',
    exposedHeaders: 'Set-Cookie',
  });
  
  // Enable global Zod validation
  app.useGlobalPipes(new ZodValidationPipe());
  
  // Set up Swagger
  const config = new DocumentBuilder()
    .setTitle('Robotics Tournament API')
    .setDescription('API for managing robotics tournaments')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
  
  // Global API prefix
  app.setGlobalPrefix('api');
  
  const port = process.env.PORT || 5000;
  await app.listen(port);
  logger.log(`Application is running on: ${await app.getUrl()}`);

  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}

bootstrap().catch((error) => {
  const logger = new Logger('Bootstrap');
  logger.error(`Failed to start application: ${error.message}`);
  process.exit(1);
});
