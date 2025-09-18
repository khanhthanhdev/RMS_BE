# RMS Backend - AI Coding Agent Instructions

## Project Overview

This is the **RMS (Robotics Management System) Backend** - a NestJS-based system for managing robotics tournaments with real-time scoring, automated match scheduling, and multi-field tournament support.

## Architecture & Tech Stack

- **Framework**: NestJS 11.0.1 with TypeScript
- **Database**: PostgreSQL with Prisma ORM (client generated to `../generated/prisma`)
- **Authentication**: JWT with HTTP-only cookies + role-based access control
- **Real-time**: Socket.IO WebSockets for live scoring and field displays
- **Validation**: Zod schemas with `nestjs-zod` integration
- **API**: RESTful with Swagger/OpenAPI documentation at `/api/docs`
- **Testing**: Jest with comprehensive unit, integration, and load testing setup

## Critical Setup Requirements

1. **Always run `npx prisma generate` after any schema changes** - The app will fail to start without it
2. **Custom Prisma client location**: Generated to `../generated/prisma` (not default `node_modules`)
3. **Environment variables**: JWT_SECRET, DATABASE_URL are critical for startup
4. **Default admin creation**: App automatically creates admin account on first run via `AuthModule.onModuleInit()`

## Database Schema Patterns

### Core Domain Models
- **Tournament** → **Stage** → **Match** → **Alliance** → **Team**
- **User** with 6 roles: `ADMIN`, `HEAD_REFEREE`, `ALLIANCE_REFEREE`, `TEAM_LEADER`, `TEAM_MEMBER`, `COMMON`
- **Field** system for multi-field tournaments with **FieldReferee** assignments
- **ScoreConfig** → **ScoreElement** flexible scoring system

### Key Relationships
- Teams can advance between stages (`currentStageId` in Team model)
- Matches belong to stages and fields with referee assignments
- Real-time scoring via **MatchScore** linked to **ScoreElement**
- **TeamStats** tracks performance across tournaments/stages

## Service Architecture Patterns

### Module Organization
```
src/
├── auth/               # JWT + role guards + security
├── tournaments/        # Tournament lifecycle management
├── stages/             # Swiss, Playoff, Final stage logic  
├── matches/            # Match CRUD + state management
├── match-scheduler/    # Automated scheduling algorithms
├── match-scores/       # Real-time scoring + leaderboards
├── field-referees/     # Field assignments
├── websockets/         # Socket.IO gateway + connection management
├── common/services/    # Shared utilities (DateValidationService)
└── prisma.service.ts   # Global Prisma service
```

### NestJS Patterns Used
- **Dependency injection**: Services inject `PrismaService` and other services
- **Guards**: `RolesGuard` for RBAC, JWT strategy for authentication
- **DTOs**: Zod validation schemas for request/response validation
- **Interceptors**: Global validation via `ZodValidationPipe`
- **Module lifecycle**: `OnModuleInit` for initialization tasks

## Development Workflows

### Essential Commands
```bash
# Database operations
npx prisma generate        # REQUIRED after schema changes
npx prisma migrate dev     # Apply database migrations  
npx prisma studio         # GUI database browser

# Development
npm run start:dev         # Hot reload with webpack-hmr
npm run start:debug       # Debugger attached
npm run build            # Production build
npm run start:prod       # Production server

# Testing
npm run test:stress      # Artillery load testing
npm run test:e2e         # End-to-end tests
npm run test:cov         # Coverage reports
```

### Critical Development Patterns

1. **Prisma Client Management**: Always check if `PrismaClient` initialization succeeds in `main.ts` before app startup
2. **Role-Based Access**: Use `@Roles()` decorator + `RolesGuard` for endpoint protection
3. **WebSocket Events**: Real-time updates via `EventsGateway` with room-based broadcasting
4. **Validation**: All DTOs use Zod schemas via `nestjs-zod` integration
5. **CORS Configuration**: Configured for credentialed requests with specific origins

## WebSocket Integration

The system uses Socket.IO extensively for real-time features:
- **Field displays**: Live match status and scoring updates
- **Score updates**: Real-time scoring during matches
- **Match state changes**: Status updates across connected clients
- **Connection management**: `CentralizedConnectionManagerService` handles room management

Key events: `join-field-display`, `update-score`, `persist-scores`, `score-update`

## Common Debugging & Issues

1. **"Prisma did not initialize"**: Run `npx prisma generate` 
2. **JWT Cookie Issues**: Check `JWT_SECRET` environment variable and CORS credentials
3. **WebSocket Connection Problems**: Verify CORS settings and authentication tokens
4. **Database Migration Errors**: Use `npx prisma migrate dev` with descriptive names
5. **Load Testing**: Use Artillery scripts in `stress-tests/` directory for performance testing

## Conventions to Follow

- **Error Handling**: Use NestJS built-in exceptions (`BadRequestException`, etc.)
- **Logging**: Use NestJS `Logger` with contextual names 
- **Database Queries**: Prefer Prisma's type-safe query methods with proper relations
- **API Responses**: Follow REST conventions with appropriate HTTP status codes
- **Real-time Updates**: Use WebSocket rooms for targeted broadcasting
- **Testing**: Write unit tests for services, integration tests for controllers

## Environment Configuration

- **Development**: Uses webpack HMR for hot reloading
- **Production**: Docker-based deployment with multi-stage builds
- **Security**: Rate limiting via `@nestjs/throttler`, bcrypt password hashing
- **Monitoring**: Health checks at `/api/health` endpoint