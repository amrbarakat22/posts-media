import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import {
  AudioProcessorService,
  ImageProcessorService,
  VideoProcessorService,
} from '@posts-media/media-processing';
import { MediaType } from '@posts-media/domain';
import { queueOptionsFor, type MediaJobPayloadV1 } from '@posts-media/queues';
import { Prisma, MediaVariantType } from '@prisma/client';
import { Worker, type Job } from 'bullmq';

import { ProcessorOrchestratorService } from '../processing/processor-orchestrator.service';
import {
  VariantPublicationService,
  type ProcessedArtifact,
} from '../processing/variant-publication.service';

@Injectable()
export class MediaQueueConsumersService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly workers: Worker<MediaJobPayloadV1>[] = [];

  public constructor(
    private readonly configuration: EnvironmentConfigurationService,
    private readonly orchestrator: ProcessorOrchestratorService,
    private readonly publication: VariantPublicationService,
    private readonly image: ImageProcessorService,
    private readonly audio: AudioProcessorService,
    private readonly video: VideoProcessorService,
  ) {}

  public onModuleInit(): void {
    if (this.configuration.values.app.nodeEnvironment === 'test') return;
    this.workers.push(
      this.create(MediaType.IMAGE),
      this.create(MediaType.AUDIO),
      this.create(MediaType.VIDEO),
    );
  }

  public async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }

  private create(type: MediaType): Worker<MediaJobPayloadV1> {
    const concurrency =
      type === MediaType.IMAGE ? 4 : type === MediaType.AUDIO ? 2 : 1;
    return new Worker<MediaJobPayloadV1>(
      `${type.toLowerCase()}-processing`,
      (job) => this.process(type, job),
      { ...queueOptionsFor(type, this.configuration.values), concurrency },
    );
  }

  private process(type: MediaType, job: Job<MediaJobPayloadV1>): Promise<void> {
    return this.orchestrator.execute(
      job.data,
      job.attemptsMade,
      async (media, workspace, leaseToken, attemptId) => {
        if (type === MediaType.IMAGE) {
          const result = await this.image.process(
            `${workspace}/original`,
            `${workspace}/optimized.webp`,
            `${workspace}/thumbnail.webp`,
            {
              maxWidth: 1920,
              maxHeight: 1920,
              thumbnailSize: 400,
              quality: 82,
            },
          );
          await this.publication.publish(
            media,
            job.data.generation,
            attemptId,
            leaseToken,
            [
              {
                path: result.optimizedPath,
                filename: 'optimized.webp',
                variantType: MediaVariantType.OPTIMIZED_IMAGE,
                mimeType: 'image/webp',
                format: 'webp',
                width: result.width,
                height: result.height,
              },
              {
                path: result.thumbnailPath,
                filename: 'thumbnail.webp',
                variantType: MediaVariantType.IMAGE_THUMBNAIL,
                mimeType: 'image/webp',
                format: 'webp',
                width: result.thumbnailWidth,
                height: result.thumbnailHeight,
              },
            ],
          );
        } else if (type === MediaType.AUDIO) {
          const result = await this.audio.process(
            `${workspace}/original`,
            `${workspace}/audio-192k.mp3`,
          );
          await this.publication.publish(
            media,
            job.data.generation,
            attemptId,
            leaseToken,
            [
              {
                path: result.outputPath,
                filename: 'audio-192k.mp3',
                variantType: MediaVariantType.NORMALIZED_AUDIO,
                mimeType: 'audio/mpeg',
                format: 'mp3',
                bitrateKbps: 192,
              },
            ],
            result.input as unknown as Prisma.InputJsonValue,
          );
        } else {
          const outputs = await this.video.process(
            `${workspace}/original`,
            workspace,
          );
          const artifacts: ProcessedArtifact[] = outputs.map((output) => {
            const thumbnail = output.label === 'thumbnail';
            const typeForOutput = thumbnail
              ? MediaVariantType.VIDEO_THUMBNAIL
              : output.label === 'source'
                ? MediaVariantType.VIDEO_SOURCE
                : output.label === '360p'
                  ? MediaVariantType.VIDEO_360P
                  : output.label === '720p'
                    ? MediaVariantType.VIDEO_720P
                    : MediaVariantType.VIDEO_1080P;
            return {
              path: output.path,
              filename: thumbnail
                ? 'thumbnail.jpg'
                : `video-${output.label}.mp4`,
              variantType: typeForOutput,
              mimeType: thumbnail ? 'image/jpeg' : 'video/mp4',
              format: thumbnail ? 'jpg' : 'mp4',
              resolutionLabel: thumbnail ? undefined : output.label,
            };
          });
          await this.publication.publish(
            media,
            job.data.generation,
            attemptId,
            leaseToken,
            artifacts,
          );
        }
      },
    );
  }
}
