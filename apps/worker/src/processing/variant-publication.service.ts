import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import { MediaVariantType } from '@prisma/client';
import {
  OBJECT_STORAGE_PORT,
  ObjectKeyService,
  type ObjectStoragePort,
  type ObjectRef,
} from '@posts-media/storage';
import type { Media, Prisma } from '@prisma/client';

export interface ProcessedArtifact {
  readonly path: string;
  readonly filename: string;
  readonly variantType: MediaVariantType;
  readonly mimeType: string;
  readonly format: string;
  readonly width?: number;
  readonly height?: number;
  readonly bitrateKbps?: number;
  readonly resolutionLabel?: string;
}

const checksum = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });

@Injectable()
export class VariantPublicationService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    private readonly keys: ObjectKeyService,
  ) {}

  public async publish(
    media: Media,
    generation: number,
    attemptId: string,
    leaseToken: string,
    artifacts: readonly ProcessedArtifact[],
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    const temporary: ObjectRef[] = [];
    const finals: ObjectRef[] = [];
    try {
      for (const artifact of artifacts) {
        const details = await stat(artifact.path);
        if (details.size === 0) throw new Error('PROCESSING_OUTPUT_INVALID');
        const ref = this.keys.processingTempKey(
          media.id,
          generation,
          attemptId,
          artifact.filename,
        );
        const final = this.keys.processedAttemptKey(
          media.postId,
          media.id,
          media.processingProfile,
          generation,
          attemptId,
          artifact.filename,
        );
        await this.storage.putFile(ref, artifact.path);
        temporary.push(ref);
        await this.storage.stat(ref);
        // Track the intended final key before copy so a partial copy or a
        // post-copy verification failure is still compensatable.
        finals.push(final);
        await this.storage.copy(ref, final);
        await this.storage.stat(final);
      }

      const completed = await this.prisma.withTransaction(async (tx) => {
        const guarded = await tx.media.updateMany({
          where: {
            id: media.id,
            processingGeneration: generation,
            processingLeaseToken: leaseToken,
          },
          data: {
            processingStatus: 'COMPLETED',
            progress: 100,
            currentStep: 'COMPLETED',
            processingCompletedAt: new Date(),
            processingLeaseToken: null,
            processingLeaseExpiresAt: null,
            activeJobId: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            metadata,
          },
        });
        if (guarded.count !== 1) return false;
        for (let index = 0; index < artifacts.length; index += 1) {
          const artifact = artifacts[index];
          const final = finals[index];
          if (artifact === undefined || final === undefined)
            throw new Error('PROCESSING_OUTPUT_INVALID');
          const details = await stat(artifact.path);
          await tx.mediaVariant.upsert({
            where: {
              mediaId_processingProfile_variantType: {
                mediaId: media.id,
                processingProfile: media.processingProfile,
                variantType: artifact.variantType,
              },
            },
            create: {
              mediaId: media.id,
              processingProfile: media.processingProfile,
              variantType: artifact.variantType,
              bucket: final.bucket,
              objectKey: final.objectKey,
              mimeType: artifact.mimeType,
              format: artifact.format,
              size: BigInt(details.size),
              checksumSha256: await checksum(artifact.path),
              width: artifact.width,
              height: artifact.height,
              bitrateKbps: artifact.bitrateKbps,
              resolutionLabel: artifact.resolutionLabel,
            },
            update: {
              bucket: final.bucket,
              objectKey: final.objectKey,
              mimeType: artifact.mimeType,
              format: artifact.format,
              size: BigInt(details.size),
              checksumSha256: await checksum(artifact.path),
              width: artifact.width,
              height: artifact.height,
              bitrateKbps: artifact.bitrateKbps,
              resolutionLabel: artifact.resolutionLabel,
            },
          });
        }
        await tx.processingAttempt.updateMany({
          where: { id: attemptId, mediaId: media.id, generation },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        return true;
      });
      if (!completed) throw new Error('PROCESSING_LEASE_LOST');
    } catch (error) {
      await this.storage
        .removeMany([...temporary, ...finals])
        .catch(() => undefined);
      throw error;
    } finally {
      await this.storage.removeMany(temporary).catch(() => undefined);
    }
  }
}
