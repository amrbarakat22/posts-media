import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';
import { PrismaService } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import {
  AUDIO_QUEUE,
  BullMediaQueue,
  IMAGE_QUEUE,
  queueOptionsFor,
  VIDEO_QUEUE,
} from '@posts-media/queues';

import { DispatchPublicationService } from './outbox/dispatch-publication.service';
import { OutboxClaimRepository } from './outbox/outbox-claim.repository';
import { OutboxCleanupService } from './outbox/outbox-cleanup.service';
import { OutboxDispatcherService } from './outbox/outbox-dispatcher.service';
import { PublicationBackoffService } from './outbox/publication-backoff.service';

const queueProvider = (token: symbol, mediaType: MediaType) => ({
  provide: token,
  inject: [EnvironmentConfigurationService],
  useFactory: (configuration: EnvironmentConfigurationService) =>
    new BullMediaQueue(
      new Queue(
        `${mediaType.toLowerCase()}-processing`,
        queueOptionsFor(mediaType, configuration.values),
      ),
    ),
});

@Module({
  imports: [ConfigurationModule],
  providers: [
    {
      provide: PrismaService,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new PrismaService(configuration.values.database.url, false),
    },
    queueProvider(IMAGE_QUEUE, MediaType.IMAGE),
    queueProvider(AUDIO_QUEUE, MediaType.AUDIO),
    queueProvider(VIDEO_QUEUE, MediaType.VIDEO),
    OutboxClaimRepository,
    PublicationBackoffService,
    DispatchPublicationService,
    OutboxDispatcherService,
    OutboxCleanupService,
  ],
})
export class WorkerModule {}
