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
  presentMedia,
  type FileValidationError,
  type MediaResponseDto,
} from '@posts-media/media';
import {
  ObjectKeyService,
  OBJECT_STORAGE_PORT,
  type ObjectRef,
  type ObjectStoragePort,
} from '@posts-media/storage';
import type { Prisma } from '@prisma/client';

import { PostsRepository } from '../repositories/posts.repository';

export interface AddPostMediaCommand {
  readonly postId: string;
  readonly idempotencyKey: string | undefined;
  readonly files: readonly Express.Multer.File[];
  readonly requestId: string;
}

export interface AddPostMediaResponseDto {
  readonly postId: string;
  readonly summary: {
    readonly submitted: number;
    readonly accepted: number;
    readonly rejected: number;
  };
  readonly accepted: MediaResponseDto[];
  readonly rejected: readonly FileValidationError[];
}

const postNotFound = (): DomainError =>
  new DomainError('POST_NOT_FOUND', 'The requested post does not exist.', 404);

const postSoftDeleted = (): DomainError =>
  new DomainError(
    'POST_SOFT_DELETED',
    'Media cannot be added to a deleted post.',
    409,
  );

const noFilesAcceptedError = (
  rejected: readonly FileValidationError[],
  submitted: number,
): DomainError =>
  new DomainError(
    'POST_MEDIA_VALIDATION_FAILED',
    'No files were accepted; every submitted file is invalid.',
    422,
    { submitted, rejected },
  );

/**
 * Partial-success add-media orchestration (Part I §2.5/§10.5). Unlike
 * atomic post creation, each file is judged independently: valid files
 * are persisted and invalid ones are reported back, and the whole request
 * fails only when *zero* files are accepted. Wrapped in the same HTTP
 * idempotency machinery as create-post, scoped to `ADD_POST_MEDIA` plus
 * the target `postId`.
 */
@Injectable()
export class AddPostMediaService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly mediaValidation: MediaValidationService,
    private readonly mediaRepository: MediaRepository,
    private readonly postsRepository: PostsRepository,
    private readonly objectKeys: ObjectKeyService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  public async execute(
    input: AddPostMediaCommand,
  ): Promise<AddPostMediaResponseDto> {
    const key = validateIdempotencyKey(input.idempotencyKey);
    const fingerprintFiles = await buildFingerprintFiles(input.files);
    const fingerprint = computeIdempotencyFingerprint({
      operation: 'ADD_POST_MEDIA',
      routeParams: { postId: input.postId },
      body: {},
      files: fingerprintFiles,
    });
    const context: IdempotencyOperationContext = {
      key,
      operation: 'ADD_POST_MEDIA',
      method: 'POST',
      routeTemplate: '/api/posts/:postId/media',
    };

    const claim = await this.idempotency.acquireOrReplay(context, fingerprint);
    if (claim.kind === 'REPLAY') {
      if (claim.outcome.responseStatus >= 400) {
        throw outcomeToDomainError(claim.outcome);
      }
      return claim.outcome.responseBody as unknown as AddPostMediaResponseDto;
    }

    const post = await this.postsRepository.findByIdIncludingDeleted(
      input.postId,
    );
    if (post === null) {
      const domainError = postNotFound();
      await this.idempotency.finalize(
        context.key,
        domainErrorToOutcome(domainError),
      );
      throw domainError;
    }
    if (post.deletedAt !== null) {
      const domainError = postSoftDeleted();
      await this.idempotency.finalize(
        context.key,
        domainErrorToOutcome(domainError),
      );
      throw domainError;
    }

    const validation = await this.mediaValidation.validateFiles(input.files);
    if (validation.validatedUploads.length === 0) {
      const domainError = noFilesAcceptedError(
        validation.errors,
        input.files.length,
      );
      await this.idempotency.finalize(
        context.key,
        domainErrorToOutcome(domainError),
      );
      throw domainError;
    }

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
            input.postId,
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
        // Serializes concurrent add-media requests for the same post so
        // sortOrder allocation below can never collide (Part I Task 11
        // Step 3). No slow I/O happens while this lock is held — all
        // MinIO work already finished above.
        await tx.$queryRaw`SELECT id FROM "Post" WHERE id = ${input.postId} FOR UPDATE`;
        const aggregate = await tx.media.aggregate({
          where: { postId: input.postId },
          _max: { sortOrder: true },
        });
        const startingSortOrder = (aggregate._max.sortOrder ?? -1) + 1;

        const accepted: MediaResponseDto[] = [];
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
            postId: input.postId,
            sortOrder: startingSortOrder + index,
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
          accepted.push(presentMedia({ ...created, variants: [] }));
        }

        const responseDto: AddPostMediaResponseDto = {
          postId: input.postId,
          summary: {
            submitted: input.files.length,
            accepted: accepted.length,
            rejected: validation.errors.length,
          },
          accepted,
          rejected: validation.errors,
        };

        await this.idempotency.finalize(
          context.key,
          {
            responseStatus: 201,
            responseBody: responseDto as unknown as Prisma.InputJsonValue,
            targetResourceId: input.postId,
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
