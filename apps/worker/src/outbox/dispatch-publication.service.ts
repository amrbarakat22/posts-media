import { Inject, Injectable } from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import { MediaType } from '@posts-media/domain';
import {
  AUDIO_QUEUE,
  IMAGE_QUEUE,
  jobNameFor,
  queueNameFor,
  type MediaJobPayloadV1,
  type MediaQueue,
  mediaJobId,
  VIDEO_QUEUE,
} from '@posts-media/queues';

import {
  OutboxClaimRepository,
  type ClaimedDispatch,
} from './outbox-claim.repository';
import { PublicationBackoffService } from './publication-backoff.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const payloadFor = (dispatch: ClaimedDispatch): MediaJobPayloadV1 => {
  const payload = dispatch.payload;
  if (
    !isRecord(payload) ||
    payload.payloadVersion !== 1 ||
    typeof payload.dispatchId !== 'string' ||
    payload.dispatchId !== dispatch.id ||
    typeof payload.mediaId !== 'string' ||
    payload.mediaId !== dispatch.mediaId ||
    typeof payload.postId !== 'string' ||
    typeof payload.mediaType !== 'string' ||
    !Object.values(MediaType).includes(payload.mediaType as MediaType) ||
    payload.generation !== dispatch.generation ||
    payload.processingProfile !== 'balanced-v1' ||
    typeof payload.reason !== 'string' ||
    payload.reason !== dispatch.reason ||
    !Object.values(['INITIAL_UPLOAD', 'MANUAL_RETRY']).includes(payload.reason)
  ) {
    throw new Error('OUTBOX_PAYLOAD_INVALID');
  }

  return payload as unknown as MediaJobPayloadV1;
};

@Injectable()
export class DispatchPublicationService {
  public constructor(
    private readonly claims: OutboxClaimRepository,
    private readonly backoff: PublicationBackoffService,
    private readonly configuration: EnvironmentConfigurationService,
    @Inject(IMAGE_QUEUE) private readonly imageQueue: MediaQueue,
    @Inject(AUDIO_QUEUE) private readonly audioQueue: MediaQueue,
    @Inject(VIDEO_QUEUE) private readonly videoQueue: MediaQueue,
  ) {}

  public async publish(dispatch: ClaimedDispatch): Promise<void> {
    let payload: MediaJobPayloadV1;
    let queue: MediaQueue;
    try {
      payload = payloadFor(dispatch);
      const expectedQueue = this.queueFor(payload.mediaType);
      const expectedJobName = jobNameFor(payload.mediaType);
      if (
        dispatch.queueName !== queueNameFor(payload.mediaType) ||
        dispatch.jobName !== expectedJobName ||
        dispatch.jobId !== mediaJobId(payload.mediaId, payload.generation)
      ) {
        throw new Error('OUTBOX_MAPPING_INVALID');
      }
      queue = expectedQueue;
    } catch (error) {
      await this.claims.markDead(
        dispatch.id,
        dispatch.leaseToken,
        'OUTBOX_MAPPING_INVALID',
        error instanceof Error ? error.message : 'Invalid outbox mapping',
      );
      return;
    }

    try {
      await queue.add(dispatch.jobName, payload, {
        jobId: dispatch.jobId,
      });
      await this.claims.markPublished(dispatch.id, dispatch.leaseToken);
    } catch (error) {
      const nextAttemptNumber = dispatch.publishAttempts + 1;
      const delay = this.backoff.delayMs(
        nextAttemptNumber,
        this.configuration.values.outbox.maxRetryDelaySeconds,
      );
      await this.claims.markRetryWait(
        dispatch.id,
        dispatch.leaseToken,
        new Date(Date.now() + delay),
        'REDIS_PUBLISH_FAILED',
        error instanceof Error ? error.message : 'Redis publication failed',
      );
    }
  }

  private queueFor(mediaType: MediaType): MediaQueue {
    switch (mediaType) {
      case MediaType.IMAGE:
        return this.imageQueue;
      case MediaType.AUDIO:
        return this.audioQueue;
      case MediaType.VIDEO:
        return this.videoQueue;
    }
  }
}
