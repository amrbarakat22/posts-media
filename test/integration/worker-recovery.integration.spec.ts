import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EnvironmentConfigurationService } from '@posts-media/configuration';
import { PrismaService, type TransactionCallback } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import { FfmpegService } from '@posts-media/media-processing';
import type { MediaJobPayloadV1 } from '@posts-media/queues';
import {
  MinioObjectStorageAdapter,
  ObjectKeyService,
} from '@posts-media/storage';
import { Queue, QueueEvents, Worker, type Job } from 'bullmq';

import { ProcessingWorkspaceService } from '../../apps/worker/src/processing/processing-workspace.service';
import { ProcessorOrchestratorService } from '../../apps/worker/src/processing/processor-orchestrator.service';
import { VariantPublicationService } from '../../apps/worker/src/processing/variant-publication.service';
import { WorkerClaimService } from '../../apps/worker/src/processing/worker-claim.service';
import { GracefulShutdownService } from '../../apps/worker/src/processing/graceful-shutdown.service';
import { assertTestInfrastructure } from '../support/test-infrastructure.guard';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL must be set for worker recovery tests');
}

const redis = {
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const prefix = `posts-media-test:task20:${randomUUID()}`;
assertTestInfrastructure({
  databaseUrl,
  redisHost: redis.host,
  minioEndpoint: process.env.MINIO_ENDPOINT ?? 'minio',
  queuePrefix: prefix,
});
const queueName = `task20-recovery-${randomUUID()}`;
const queue = new Queue<MediaJobPayloadV1>(queueName, {
  connection: redis,
  prefix,
});
const events = new QueueEvents(queueName, { connection: redis, prefix });

const prisma = new PrismaService(databaseUrl);
const storage = new MinioObjectStorageAdapter({
  endpoint: process.env.MINIO_ENDPOINT ?? 'minio',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSsl: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin123',
});
const keys = new ObjectKeyService({
  originals: process.env.MINIO_ORIGINALS_BUCKET ?? 'post-originals',
  processed: process.env.MINIO_PROCESSED_BUCKET ?? 'post-processed',
  temporary: process.env.MINIO_TEMP_BUCKET ?? 'post-temporary',
});
const workerRoot = join(tmpdir(), `posts-media-task20-${randomUUID()}`);
const configuration = {
  values: {
    worker: {
      processingLeaseSeconds: 5,
      processingLeaseRenewSeconds: 1,
      mediaJobAttempts: 3,
      temporaryRoot: workerRoot,
    },
  },
} as EnvironmentConfigurationService;
const claims = new WorkerClaimService(prisma);
const workspace = new ProcessingWorkspaceService(configuration, storage);
const orchestrator = new ProcessorOrchestratorService(
  claims,
  workspace,
  configuration,
);
const publication = new VariantPublicationService(prisma, storage, keys);

interface Fixture {
  readonly mediaId: string;
  readonly payload: MediaJobPayloadV1;
  readonly originalRef: { readonly bucket: string; readonly objectKey: string };
}

const seed = async (generation = 1): Promise<Fixture> => {
  const post = await prisma.post.create({
    data: { title: 'Task 20 worker recovery', content: 'real BullMQ path' },
  });
  const mediaId = randomUUID();
  const originalRef = keys.originalKey(post.id, mediaId, 'png');
  const bytes = Buffer.from(`task20-original-${mediaId}`);
  const localRoot = await mkdtemp(join(tmpdir(), 'task20-original-'));
  const localPath = join(localRoot, 'original.png');
  await writeFile(localPath, bytes);
  await storage.putFile(originalRef, localPath);
  await rm(localRoot, { recursive: true, force: true });
  const media = await prisma.media.create({
    data: {
      id: mediaId,
      postId: post.id,
      sortOrder: 0,
      mediaType: MediaType.IMAGE,
      originalFilename: 'fixture.png',
      originalExtension: 'png',
      declaredMimeType: 'image/png',
      detectedMimeType: 'image/png',
      detectedFormat: 'png',
      originalBucket: originalRef.bucket,
      originalObjectKey: originalRef.objectKey,
      originalSize: BigInt(bytes.length),
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      processingGeneration: generation,
    },
  });
  const dispatchId = randomUUID();
  return {
    mediaId,
    originalRef,
    payload: {
      payloadVersion: 1,
      dispatchId,
      mediaId,
      postId: post.id,
      mediaType: MediaType.IMAGE,
      generation,
      processingProfile: 'balanced-v1',
      reason: generation === 1 ? 'INITIAL_UPLOAD' : 'MANUAL_RETRY',
    },
  };
};

const startWorker = (
  handler: (job: Job<MediaJobPayloadV1>) => Promise<void>,
): Worker<MediaJobPayloadV1> =>
  new Worker<MediaJobPayloadV1>(queueName, handler, {
    connection: redis,
    prefix,
    concurrency: 1,
  });

const publishVariant = async (
  job: Job<MediaJobPayloadV1>,
  media: Parameters<Parameters<typeof orchestrator.execute>[2]>[0],
  directory: string,
  leaseToken: string,
  attemptId: string,
): Promise<void> => {
  const path = join(directory, 'optimized.webp');
  await writeFile(path, Buffer.from(`variant-${job.data.mediaId}`));
  await publication.publish(media, job.data.generation, attemptId, leaseToken, [
    {
      path,
      filename: 'optimized.webp',
      variantType: 'OPTIMIZED_IMAGE',
      mimeType: 'image/webp',
      format: 'webp',
      width: 10,
      height: 10,
    },
  ]);
};

describe('real BullMQ worker failure and recovery', () => {
  beforeAll(async () => {
    await prisma.onModuleInit();
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await Promise.all([events.close(), queue.close()]);
    await rm(workerRoot, { recursive: true, force: true });
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await prisma.processingDispatch.deleteMany();
    await prisma.processingAttempt.deleteMany();
    await prisma.mediaVariant.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  it('keeps the generation stable and completes on a later automatic attempt', async () => {
    const fixture = await seed();
    const worker = startWorker(async (job) =>
      orchestrator.execute(job.data, job.attemptsMade, async (...args) => {
        if (job.attemptsMade < 2)
          throw new Error('controlled retryable failure');
        await publishVariant(job, ...args);
      }),
    );
    try {
      const job = await queue.add('process-image', fixture.payload, {
        jobId: `automatic-success-${fixture.mediaId}`,
        attempts: 3,
        backoff: { type: 'fixed', delay: 25 },
      });
      await job.waitUntilFinished(events, 15_000);

      const media = await prisma.media.findUniqueOrThrow({
        where: { id: fixture.mediaId },
        include: {
          attempts: { orderBy: { bullAttemptNumber: 'asc' } },
          variants: true,
        },
      });
      expect(media.processingGeneration).toBe(1);
      expect(media.processingStatus).toBe('COMPLETED');
      expect(media.lastErrorCode).toBeNull();
      expect(media.lastErrorMessage).toBeNull();
      expect(
        media.attempts.map((attempt) => attempt.bullAttemptNumber),
      ).toEqual([1, 2, 3]);
      expect(media.attempts.map((attempt) => attempt.status)).toEqual([
        'FAILED',
        'FAILED',
        'COMPLETED',
      ]);
      expect(media.variants).toHaveLength(1);
    } finally {
      await worker.close();
      await storage.remove(fixture.originalRef).catch(() => undefined);
    }
  }, 30_000);

  it('marks media FAILED after attempts are exhausted and retains sanitized history', async () => {
    const fixture = await seed();
    const worker = startWorker(async (job) =>
      orchestrator.execute(job.data, job.attemptsMade, async () => {
        throw new Error('/tmp/private/input.mp4 secret=do-not-expose');
      }),
    );
    try {
      const job = await queue.add('process-image', fixture.payload, {
        jobId: `automatic-exhausted-${fixture.mediaId}`,
        attempts: 3,
        backoff: { type: 'fixed', delay: 25 },
      });
      await expect(job.waitUntilFinished(events, 15_000)).rejects.toThrow();

      const media = await prisma.media.findUniqueOrThrow({
        where: { id: fixture.mediaId },
        include: { attempts: true, variants: true },
      });
      expect(media.processingGeneration).toBe(1);
      expect(media.processingStatus).toBe('FAILED');
      expect(media.lastErrorCode).toBe('PROCESSING_FAILED');
      expect(media.lastErrorMessage).toBe('Media processing failed.');
      expect(media.attempts).toHaveLength(3);
      expect(
        media.attempts.every((attempt) => attempt.status === 'FAILED'),
      ).toBe(true);
      expect(media.variants).toHaveLength(0);
    } finally {
      await worker.close();
      await storage.remove(fixture.originalRef).catch(() => undefined);
    }
  }, 30_000);

  it('no-ops duplicate logical delivery after the generation completed', async () => {
    const fixture = await seed();
    const worker = startWorker(async (job) =>
      orchestrator.execute(job.data, job.attemptsMade, (...args) =>
        publishVariant(job, ...args),
      ),
    );
    try {
      const first = await queue.add('process-image', fixture.payload, {
        jobId: `duplicate-first-${fixture.mediaId}`,
      });
      await first.waitUntilFinished(events, 15_000);
      const duplicate = await queue.add('process-image', fixture.payload, {
        jobId: `duplicate-replay-${fixture.mediaId}`,
      });
      await duplicate.waitUntilFinished(events, 15_000);

      expect(
        await prisma.processingAttempt.count({
          where: { mediaId: fixture.mediaId },
        }),
      ).toBe(1);
      expect(
        await prisma.mediaVariant.count({
          where: { mediaId: fixture.mediaId },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.media.findUniqueOrThrow({
            where: { id: fixture.mediaId },
          })
        ).processingStatus,
      ).toBe('COMPLETED');
    } finally {
      await worker.close();
      await storage.remove(fixture.originalRef).catch(() => undefined);
    }
  }, 30_000);

  it('no-ops a delayed stale-generation job without touching generation 2', async () => {
    const fixture = await seed(2);
    await prisma.media.update({
      where: { id: fixture.mediaId },
      data: {
        progress: 37,
        currentStep: 'PROCESSING',
        metadata: { sentinel: 'generation-2' },
        lastErrorCode: 'CURRENT_GENERATION_ERROR',
        lastErrorMessage: 'current generation owns this state',
      },
    });
    const stalePayload = { ...fixture.payload, generation: 1 };
    const worker = startWorker(async (job) =>
      orchestrator.execute(job.data, job.attemptsMade, async () => {
        throw new Error('stale handler must not run');
      }),
    );
    try {
      const job = await queue.add('process-image', stalePayload, {
        jobId: `stale-generation-${fixture.mediaId}`,
      });
      await job.waitUntilFinished(events, 15_000);

      expect(
        await prisma.media.findUniqueOrThrow({
          where: { id: fixture.mediaId },
        }),
      ).toMatchObject({
        processingGeneration: 2,
        processingStatus: 'PENDING',
        progress: 37,
        currentStep: 'PROCESSING',
        metadata: { sentinel: 'generation-2' },
        lastErrorCode: 'CURRENT_GENERATION_ERROR',
        lastErrorMessage: 'current generation owns this state',
      });
      expect(
        await prisma.processingAttempt.count({
          where: { mediaId: fixture.mediaId },
        }),
      ).toBe(0);
    } finally {
      await worker.close();
      await storage.remove(fixture.originalRef).catch(() => undefined);
    }
  }, 30_000);

  it("cannot overwrite or remove a newer lease owner's immutable published object", async () => {
    const fixture = await seed();
    let publishedRef:
      | { readonly bucket: string; readonly objectKey: string }
      | undefined;
    const artifactRoot = await mkdtemp(join(tmpdir(), 'lease-race-artifacts-'));
    const staleArtifact = join(artifactRoot, 'stale.webp');
    const currentArtifact = join(artifactRoot, 'current.webp');
    await Promise.all([
      writeFile(staleArtifact, Buffer.from('stale-owner-bytes')),
      writeFile(currentArtifact, Buffer.from('current-owner-bytes')),
    ]);
    try {
      const staleToken = randomUUID();
      const staleClaim = await claims.claim(
        fixture.mediaId,
        1,
        'lease-race-job',
        5,
        staleToken,
      );
      expect(staleClaim).not.toBeNull();
      const staleAttempt = await claims.createAttempt(
        fixture.mediaId,
        1,
        1,
        'lease-race-job',
        'balanced-v1',
      );
      const currentToken = randomUUID();
      await prisma.media.update({
        where: { id: fixture.mediaId },
        data: {
          processingLeaseToken: currentToken,
          processingLeaseExpiresAt: new Date(Date.now() + 5000),
        },
      });
      const currentAttempt = await claims.createAttempt(
        fixture.mediaId,
        1,
        2,
        'lease-race-job',
        'balanced-v1',
      );
      const currentPublication = () =>
        publication.publish(
          staleClaim!.media,
          1,
          currentAttempt.id,
          currentToken,
          [
            {
              path: currentArtifact,
              filename: 'optimized.webp',
              variantType: 'OPTIMIZED_IMAGE',
              mimeType: 'image/webp',
              format: 'webp',
            },
          ],
        );
      const stalePrisma = {
        withTransaction: async <T>(
          callback: TransactionCallback<T>,
        ): Promise<T> => {
          await currentPublication();
          return prisma.withTransaction(callback);
        },
      };
      const stalePublication = new VariantPublicationService(
        stalePrisma as never,
        storage,
        keys,
      );

      await expect(
        stalePublication.publish(
          staleClaim!.media,
          1,
          staleAttempt.id,
          staleToken,
          [
            {
              path: staleArtifact,
              filename: 'optimized.webp',
              variantType: 'OPTIMIZED_IMAGE',
              mimeType: 'image/webp',
              format: 'webp',
            },
          ],
        ),
      ).rejects.toThrow('PROCESSING_LEASE_LOST');

      const variant = await prisma.mediaVariant.findFirstOrThrow({
        where: { mediaId: fixture.mediaId },
      });
      const currentRef = keys.processedAttemptKey(
        staleClaim!.media.postId,
        fixture.mediaId,
        'balanced-v1',
        1,
        currentAttempt.id,
        'optimized.webp',
      );
      publishedRef = currentRef;
      const staleRef = keys.processedAttemptKey(
        staleClaim!.media.postId,
        fixture.mediaId,
        'balanced-v1',
        1,
        staleAttempt.id,
        'optimized.webp',
      );
      expect(variant.objectKey).toBe(currentRef.objectKey);
      await expect(storage.exists(currentRef)).resolves.toBe(true);
      await expect(storage.exists(staleRef)).resolves.toBe(false);
    } finally {
      if (publishedRef !== undefined) {
        await storage.remove(publishedRef).catch(() => undefined);
      }
      await storage.remove(fixture.originalRef).catch(() => undefined);
      await rm(artifactRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('interrupts an active child, releases the attempt, and recovers after worker restart', async () => {
    const fixture = await seed();
    const graceful = new GracefulShutdownService();
    const ffmpeg = new FfmpegService(graceful);
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const processJob = async (job: Job<MediaJobPayloadV1>) =>
      orchestrator.execute(job.data, job.attemptsMade, async (...args) => {
        if (job.attemptsMade === 0) {
          signalStarted();
          await ffmpeg.run(['-e', 'setInterval(() => undefined, 1000)'], {
            binary: process.execPath,
            timeoutMs: 60_000,
          });
          return;
        }
        await publishVariant(job, ...args);
      });
    const firstWorker = startWorker(processJob);
    let recoveryWorker: Worker<MediaJobPayloadV1> | undefined;
    try {
      const job = await queue.add('process-image', fixture.payload, {
        jobId: `worker-interruption-${fixture.mediaId}`,
        attempts: 3,
        backoff: { type: 'fixed', delay: 25 },
      });
      await started;
      await firstWorker.pause(true);
      await graceful.shutdown(1000);
      const releaseDeadline = Date.now() + 5000;
      while (
        (await job.getState()) === 'active' &&
        Date.now() < releaseDeadline
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      expect(await job.getState()).not.toBe('active');
      await firstWorker.close();

      recoveryWorker = startWorker(processJob);
      await job.waitUntilFinished(events, 15_000);

      const media = await prisma.media.findUniqueOrThrow({
        where: { id: fixture.mediaId },
        include: { attempts: { orderBy: { bullAttemptNumber: 'asc' } } },
      });
      expect(media.processingStatus).toBe('COMPLETED');
      expect(media.processingGeneration).toBe(1);
      expect(media.attempts.map((attempt) => attempt.status)).toEqual([
        'FAILED',
        'COMPLETED',
      ]);
      for (const attempt of media.attempts) {
        await expect(
          stat(join(workerRoot, fixture.mediaId, '1', attempt.id)),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      }
    } finally {
      await firstWorker.close(true).catch(() => undefined);
      await recoveryWorker?.close(true);
      await storage.remove(fixture.originalRef).catch(() => undefined);
    }
  }, 30_000);
});
