import { Module } from '@nestjs/common';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';
import { DatabaseModule, IdempotencyModule } from '@posts-media/database';
import { StorageModule } from '@posts-media/storage';

import { MediaService } from './application/media.service';
import { MediaRepository } from './repositories/media.repository';
import { MediaValidationService } from './validation/media-validation.service';

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    IdempotencyModule,
    StorageModule,
  ],
  providers: [
    MediaRepository,
    MediaService,
    {
      provide: MediaValidationService,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new MediaValidationService(configuration.values.upload),
    },
  ],
  exports: [MediaRepository, MediaValidationService, MediaService],
})
export class MediaModule {}
