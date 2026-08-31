import { Injectable } from '@nestjs/common';
import { PrismaService, type DatabaseClient } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import { jobNameFor, mediaJobId, queueNameFor } from '@posts-media/queues';
import type { MediaJobPayloadV1 } from '@posts-media/queues';
import type { Media, Prisma } from '@prisma/client';

export interface CreateMediaWithDispatchInput {
  readonly id: string;
  readonly postId: string;
  readonly sortOrder: number;
  readonly mediaType: MediaType;
  readonly originalFilename: string;
  readonly originalExtension: string;
  readonly declaredMimeType: string;
  readonly detectedMimeType: string;
  readonly detectedFormat: string;
  readonly originalBucket: string;
  readonly originalObjectKey: string;
  readonly originalSize: bigint;
  readonly checksumSha256: string;
  readonly metadata: Prisma.InputJsonValue;
  readonly dispatchId: string;
}

/**
 * Prisma-backed persistence for `Media` and its initial
 * `ProcessingDispatch` row (Part I §12.1). Every method takes an explicit
 * `DatabaseClient` so callers (Task 10's atomic create, Task 11's
 * add-media) can run these writes inside their own domain transaction
 * alongside the `IdempotencyRequest` finalize.
 */
@Injectable()
export class MediaRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public findById(
    id: string,
  ): Promise<Media & { variants: Prisma.MediaVariantGetPayload<object>[] }> {
    return this.prisma.media.findUniqueOrThrow({
      where: { id },
      include: { variants: true },
    });
  }

  /**
   * Creates one `Media` row (status `PENDING`, generation 1) and its
   * generation-1 `ProcessingDispatch` row in the given client. Both ids
   * (`input.id`, `input.dispatchId`) are caller-generated so they can be
   * referenced (e.g. in MinIO object keys or the job payload) before this
   * insert runs.
   */
  public async createWithDispatch(
    client: DatabaseClient,
    input: CreateMediaWithDispatchInput,
  ): Promise<Media> {
    const media = await client.media.create({
      data: {
        id: input.id,
        postId: input.postId,
        sortOrder: input.sortOrder,
        mediaType: input.mediaType,
        originalFilename: input.originalFilename,
        originalExtension: input.originalExtension,
        declaredMimeType: input.declaredMimeType,
        detectedMimeType: input.detectedMimeType,
        detectedFormat: input.detectedFormat,
        originalBucket: input.originalBucket,
        originalObjectKey: input.originalObjectKey,
        originalSize: input.originalSize,
        checksumSha256: input.checksumSha256,
        metadata: input.metadata,
      },
    });

    const generation = 1;
    const payload: MediaJobPayloadV1 = {
      payloadVersion: 1,
      dispatchId: input.dispatchId,
      mediaId: input.id,
      postId: input.postId,
      mediaType: input.mediaType,
      generation,
      processingProfile: 'balanced-v1',
      reason: 'INITIAL_UPLOAD',
    };

    await client.processingDispatch.create({
      data: {
        id: input.dispatchId,
        mediaId: input.id,
        generation,
        reason: 'INITIAL_UPLOAD',
        queueName: queueNameFor(input.mediaType),
        jobName: jobNameFor(input.mediaType),
        jobId: mediaJobId(input.id, generation),
        payloadVersion: 1,
        payload: payload as unknown as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });

    return media;
  }
}
