import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';
import { PrismaService } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import {
  MinioObjectStorageAdapter,
  ObjectKeyService,
  OBJECT_STORAGE_PORT,
} from '@posts-media/storage';
import {
  AudioProcessorService,
  FfmpegService,
  FfprobeService,
  ImageProcessorService,
  VideoProcessorService,
} from '@posts-media/media-processing';
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
import { WorkerClaimService } from './processing/worker-claim.service';
import { GracefulShutdownService } from './processing/graceful-shutdown.service';
import { ProcessingWorkspaceService } from './processing/processing-workspace.service';
import { ProcessorOrchestratorService } from './processing/processor-orchestrator.service';
import { VariantPublicationService } from './processing/variant-publication.service';
import { MediaQueueConsumersService } from './consumers/media-queue-consumers.service';
import { WorkerHeartbeatService } from './heartbeat/worker-heartbeat.service';

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
    {
      provide: OBJECT_STORAGE_PORT,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new MinioObjectStorageAdapter(configuration.values.storage),
    },
    {
      provide: ObjectKeyService,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new ObjectKeyService({
          originals: configuration.values.storage.originalsBucket,
          processed: configuration.values.storage.processedBucket,
          temporary: configuration.values.storage.temporaryBucket,
        }),
    },
    queueProvider(IMAGE_QUEUE, MediaType.IMAGE),
    queueProvider(AUDIO_QUEUE, MediaType.AUDIO),
    queueProvider(VIDEO_QUEUE, MediaType.VIDEO),
    OutboxClaimRepository,
    PublicationBackoffService,
    DispatchPublicationService,
    OutboxDispatcherService,
    OutboxCleanupService,
    WorkerClaimService,
    GracefulShutdownService,
    FfprobeService,
    FfmpegService,
    ImageProcessorService,
    AudioProcessorService,
    VideoProcessorService,
    ProcessingWorkspaceService,
    ProcessorOrchestratorService,
    VariantPublicationService,
    MediaQueueConsumersService,
    WorkerHeartbeatService,
  ],
})
export class WorkerModule {}
