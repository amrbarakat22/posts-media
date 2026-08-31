import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  computeIdempotencyFingerprint,
  domainErrorToOutcome,
  IdempotencyService,
  outcomeToDomainError,
  PrismaService,
  validateIdempotencyKey,
  type IdempotencyOperationContext,
} from '@posts-media/database';
import { DomainError } from '@posts-media/domain';
import {
  buildFingerprintFiles,
  MediaRepository,
  MediaValidationService,
} from '@posts-media/media';
import {
  ObjectKeyService,
  OBJECT_STORAGE_PORT,
  type ObjectRef,
  type ObjectStoragePort,
} from '@posts-media/storage';
import type { Media, Prisma } from '@prisma/client';

import {
  presentPost,
  type PostResponseDto,
} from '../presenters/post.presenter';

export interface CreatePostWithMediaCommand {
  readonly idempotencyKey: string | undefined;
  readonly title: string;
  readonly content: string;
  readonly files: readonly Express.Multer.File[];
  /** Namespaces this request's MinIO upload-staging keys (Part I §2.1). */
  readonly requestId: string;
}

const validationFailedError = (
  rejected: readonly unknown[],
  submitted: number,
): DomainError =>
  new DomainError(
    'POST_MEDIA_VALIDATION_FAILED',
    'The post was not created because one or more files are invalid.',
    422,
    { submitted, rejected },
  );

/**
 * Atomic create-post-with-initial-media orchestration (Part I §2.4/§2.5/
 * §10.4). Creating a post with initial media is all-or-nothing from the
 * client's perspective: if any submitted file is invalid, no Post, Media,
 * or original object is created. Wraps `POST /api/posts` in HTTP
 * idempotency — the same `Idempotency-Key` + request always replays the
 * original result instead of re-running any of this.
 */
@Injectable()
export class CreatePostService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly mediaValidation: MediaValidationService,
    private readonly mediaRepository: MediaRepository,
    private readonly objectKeys: ObjectKeyService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  public async execute(
    input: CreatePostWithMediaCommand,
  ): Promise<PostResponseDto> {
    const key = validateIdempotencyKey(input.idempotencyKey);
    const fingerprintFiles = await buildFingerprintFiles(input.files);
    const fingerprint = computeIdempotencyFingerprint({
      operation: 'CREATE_POST',
      routeParams: {},
      body: { title: input.title, content: input.content },
      files: fingerprintFiles,
    });
    const context: IdempotencyOperationContext = {
      key,
      operation: 'CREATE_POST',
      method: 'POST',
      routeTemplate: '/api/posts',
    };

    const claim = await this.idempotency.acquireOrReplay(context, fingerprint);
    if (claim.kind === 'REPLAY') {
      if (claim.outcome.responseStatus >= 400) {
        throw outcomeToDomainError(claim.outcome);
      }
      return claim.outcome.responseBody as unknown as PostResponseDto;
    }

    const validation = await this.mediaValidation.validateFiles(input.files);
    if (validation.errors.length > 0) {
      const domainError = validationFailedError(
        validation.errors,
        input.files.length,
      );
      await this.idempotency.finalize(
        context.key,
        domainErrorToOutcome(domainError),
      );
      throw domainError;
    }

    const postId = randomUUID();
    const mediaIds = validation.validatedUploads.map(() => randomUUID());
    const dispatchIds = validation.validatedUploads.map(() => randomUUID());
    const promoted: ObjectRef[] = [];

    try {
      for (
        let index = 0;
        index < validation.validatedUploads.length;
        index += 1
      ) {
        const upload = validation.validatedUploads[index];
        const mediaId = mediaIds[index];
        if (upload === undefined || mediaId === undefined) continue;

        const stagingRef = this.objectKeys.uploadStagingKey(
          input.requestId,
          String(upload.fileIndex),
        );
        await this.storage.putFile(stagingRef, upload.temporaryPath);
        try {
          const originalRef = this.objectKeys.originalKey(
            postId,
            mediaId,
            upload.extension,
          );
          await this.storage.copy(stagingRef, originalRef);
          promoted.push(originalRef);
        } finally {
          await this.storage.remove(stagingRef).catch(() => undefined);
        }
      }
    } catch {
      await this.compensatePromotedOriginals(promoted);
      await this.idempotency.markRetryableFailure(context.key);
      throw new DomainError(
        'ORIGINAL_PROMOTION_FAILED',
        'The uploaded media could not be stored.',
        503,
      );
    }

    try {
      return await this.prisma.withTransaction(async (tx) => {
        const post = await tx.post.create({
          data: { id: postId, title: input.title, content: input.content },
        });

        const media: Media[] = [];
        for (
          let index = 0;
          index < validation.validatedUploads.length;
          index += 1
        ) {
          const upload = validation.validatedUploads[index];
          const mediaId = mediaIds[index];
          const dispatchId = dispatchIds[index];
          const originalRef = promoted[index];
          if (
            upload === undefined ||
            mediaId === undefined ||
            dispatchId === undefined ||
            originalRef === undefined
          ) {
            continue;
          }

          const created = await this.mediaRepository.createWithDispatch(tx, {
            id: mediaId,
            postId,
            sortOrder: index,
            mediaType: upload.mediaType,
            originalFilename: upload.originalFilename,
            originalExtension: upload.extension,
            declaredMimeType: upload.declaredMimeType,
            detectedMimeType: upload.detectedMimeType,
            detectedFormat: upload.detectedFormat,
            originalBucket: originalRef.bucket,
            originalObjectKey: originalRef.objectKey,
            originalSize: upload.sizeBytes,
            checksumSha256: upload.checksumSha256,
            metadata: upload.preliminaryMetadata as Prisma.InputJsonValue,
            dispatchId,
          });
          media.push(created);
        }

        const responseDto = presentPost({ ...post, media });
        await this.idempotency.finalize(
          context.key,
          {
            responseStatus: 201,
            responseBody: responseDto as unknown as Prisma.InputJsonValue,
            targetResourceId: postId,
          },
          tx,
        );
        return responseDto;
      });
    } catch (error) {
      await this.compensatePromotedOriginals(promoted);
      await this.idempotency.markRetryableFailure(context.key);
      throw error;
    }
  }

  private async compensatePromotedOriginals(
    promoted: readonly ObjectRef[],
  ): Promise<void> {
    if (promoted.length === 0) return;
    await this.storage.removeMany([...promoted]).catch(() => undefined);
  }
}
