import { Module } from '@nestjs/common';
import { join } from 'path';
import { existsSync } from 'fs';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompaniesModule } from './companies/companies.module';
import { SearchModule } from './search/search.module';
import { ExportModule } from './export/export.module';
import { AdminModule } from './admin/admin.module';
import { ConsentModule } from './consent/consent.module';
import { User } from './users/user.entity';
import { Company } from './companies/company.entity';
import { SearchLog } from './companies/search-log.entity';
import { ProcessState } from './companies/process-state.entity';
import { ConsentEvent } from './consent/consent-event.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../.env', '.env'] }),
    ScheduleModule.forRoot(),
    // serve the built React app (production single-service deploy) when present
    ...(existsSync(join(__dirname, '..', 'client', 'index.html'))
      ? [
          ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', 'client'),
            exclude: ['/api*'],
          }),
        ]
      : []),
    ThrottlerModule.forRoot([
      { ttl: 60000, limit: parseInt(process.env.RATE_LIMIT_DEFAULT || '100', 10) },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        url: cfg.get<string>('DATABASE_URL'),
        ssl: { rejectUnauthorized: false },
        entities: [User, Company, SearchLog, ConsentEvent, ProcessState],
        synchronize: true, // MVP: auto-create schema. Use migrations in real prod.
        // cap the pool so we never exhaust Neon free-tier connections (the 500s)
        extra: { max: 10, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000 },
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
    AuthModule,
    UsersModule,
    CompaniesModule,
    SearchModule,
    ExportModule,
    AdminModule,
    ConsentModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
