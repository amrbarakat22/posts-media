import { Module } from '@nestjs/common';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';

import { MediaRepository } from './repositories/media.repository';
import { MediaValidationService } from './validation/media-validation.service';

@Module({
  imports: [ConfigurationModule],
  providers: [
    MediaRepository,
    {
      provide: MediaValidationService,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new MediaValidationService(configuration.values.upload),
    },
  ],
  exports: [MediaRepository, MediaValidationService],
})
export class MediaModule {}
