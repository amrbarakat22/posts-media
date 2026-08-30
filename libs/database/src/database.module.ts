import { Global, Module } from '@nestjs/common';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';

import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [ConfigurationModule],
  providers: [
    {
      provide: PrismaService,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new PrismaService(configuration.values.database.url),
    },
  ],
  exports: [PrismaService],
})
export class DatabaseModule {}
