import { randomUUID } from 'node:crypto';

import { Injectable, Inject } from '@nestjs/common';
import {
  computeIdempotencyFingerprint,
  IdempotencyService,
  PrismaService,
  validateIdempotencyKey,
  type IdempotencyOperationContext,
} from '@posts-media/database';
import { DomainError, MediaType } from '@posts-media/domain';
import { jobNameFor, mediaJobId, queueNameFor } from '@posts-media/queues';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
} from '@posts-media/storage';
import { Prisma } from '@prisma/client';

import { MediaRepository } from '../repositories/media.repository';
import {
  presentMedia,
  type MediaResponseDto,
} from '../presenters/media.presenter';

export interface MediaAccessResponse {
  readonly original: string;
  readonly variants: Record<string, string>;
}

@Injectable()
export class MediaService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly repository: MediaRepository,
    private readonly idempotency: IdempotencyService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  public async get(id: string): Promise<MediaResponseDto> {
    try {
      return presentMedia(await this.repository.findById(id));
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new DomainError(
          'MEDIA_NOT_FOUND',
          'The requested media does not exist.',
          404,
        );
      }
      throw error;
    }
  }

  public async access(id: string): Promise<MediaAccessResponse> {
    const media = await this.repository.findById(id);
    const original = await this.storage.presignedGet(
      { bucket: media.originalBucket, objectKey: media.originalObjectKey },
      900,
    );
    const variants: Record<string, string> = {};
    for (const variant of media.variants) {
      variants[variant.variantType] = await this.storage.presignedGet(
        { bucket: variant.bucket, objectKey: variant.objectKey },
        900,
      );
    }
    return { original, variants };
  }

  public async retry(
    id: string,
    idempotencyKey: string | undefined,
  ): Promise<MediaResponseDto> {
    const key = validateIdempotencyKey(idempotencyKey);
    const context: IdempotencyOperationContext = {
      key,
      operation: 'RETRY_MEDIA',
      method: 'POST',
      routeTemplate: '/api/media/:mediaId/retry',
    };
    const fingerprint = computeIdempotencyFingerprint({
      operation: 'RETRY_MEDIA',
      routeParams: { mediaId: id },
      body: {},
      files: [],
    });
    const execution = await this.idempotency.executeIdempotent(
      context,
      fingerprint,
      async () => {
        const media = await this.prisma.withTransaction(async (tx) => {
          const current = await tx.media.findUnique({ where: { id } });
          if (current === null)
            throw new DomainError(
              'MEDIA_NOT_FOUND',
              'The requested media does not exist.',
              404,
            );
          if (current.processingStatus !== 'FAILED') {
            throw new DomainError(
              'MEDIA_RETRY_NOT_ALLOWED',
              'Only failed media can be retried.',
              409,
            );
          }
          const generation = current.processingGeneration + 1;
          const updated = await tx.media.update({
            where: { id },
            data: {
              processingGeneration: generation,
              processingStatus: 'PENDING',
              progress: 0,
              currentStep: 'PENDING',
              processingStartedAt: null,
              processingCompletedAt: null,
              processingLeaseToken: null,
              processingLeaseExpiresAt: null,
              activeJobId: null,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
            include: { variants: true },
          });
          const dispatchId = randomUUID();
          const payload = {
            payloadVersion: 1,
            dispatchId,
            mediaId: id,
            postId: current.postId,
            mediaType: current.mediaType,
            generation,
            processingProfile: current.processingProfile,
            reason: 'MANUAL_RETRY',
          } as unknown as Prisma.InputJsonValue;
          await tx.processingDispatch.create({
            data: {
              id: dispatchId,
              mediaId: id,
              generation,
              reason: 'MANUAL_RETRY',
              queueName: queueNameFor(current.mediaType as MediaType),
              jobName: jobNameFor(current.mediaType as MediaType),
              jobId: mediaJobId(id, generation),
              payloadVersion: 1,
              payload,
            },
          });
          return updated;
        });
        const body = presentMedia(media);
        return {
          responseStatus: 200,
          responseBody: body as unknown as Prisma.InputJsonValue,
          targetResourceId: id,
        };
      },
    );
    return execution.outcome.responseBody as unknown as MediaResponseDto;
  }
}
