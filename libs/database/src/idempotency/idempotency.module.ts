import { Module } from '@nestjs/common';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';

import { DatabaseModule } from '../database.module';
import { PrismaService } from '../prisma.service';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { IdempotencyService } from './idempotency.service';

@Module({
  imports: [ConfigurationModule, DatabaseModule],
  providers: [
    IdempotencyCleanupService,
    {
      provide: IdempotencyService,
      inject: [PrismaService, EnvironmentConfigurationService],
      useFactory: (
        prisma: PrismaService,
        configuration: EnvironmentConfigurationService,
      ) =>
        new IdempotencyService(
          prisma,
          configuration.values.idempotency.ttlHours,
          configuration.values.idempotency.leaseSeconds,
        ),
    },
  ],
  exports: [IdempotencyService, IdempotencyCleanupService],
})
export class IdempotencyModule {}
