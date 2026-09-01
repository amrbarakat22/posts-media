import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import type { EnvironmentConfigurationService } from '@posts-media/configuration';
import { PrismaService } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import {
  BullMediaQueue,
  mediaJobId,
  queueOptionsFor,
  type MediaJobPayloadV1,
} from '@posts-media/queues';
import {
  MinioObjectStorageAdapter,
  ObjectKeyService,
} from '@posts-media/storage';
import { Queue, QueueEvents, Worker } from 'bullmq';
import * as request from 'supertest';

import { bootstrap } from '../../apps/api/src/main';
import { DispatchPublicationService } from '../../apps/worker/src/outbox/dispatch-publication.service';
import { OutboxClaimRepository } from '../../apps/worker/src/outbox/outbox-claim.repository';
import { PublicationBackoffService } from '../../apps/worker/src/outbox/publication-backoff.service';
import { ProcessingWorkspaceService } from '../../apps/worker/src/processing/processing-workspace.service';
import { ProcessorOrchestratorService } from '../../apps/worker/src/processing/processor-orchestrator.service';
import { VariantPublicationService } from '../../apps/worker/src/processing/variant-publication.service';
import { WorkerClaimService } from '../../apps/worker/src/processing/worker-claim.service';
import { validEnvironment, withEnvironment } from '../support/environment';
import { assertTestInfrastructure } from '../support/test-infrastructure.guard';

const availablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Unable to resolve an ephemeral port'));
        return;
      }
      server.close((error) =>
        error === undefined ? resolve(address.port) : reject(error),
      );
    });
  });

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://posts:posts@postgres:5432/posts_media_test';
const prisma = new PrismaService(databaseUrl);
const redis = {
  host: process.env.REDIS_HOST ?? 'redis',
  port: Number(process.env.REDIS_PORT ?? 6379),
};
const queuePrefix = `posts-media-test:media-retry:${randomUUID()}`;
assertTestInfrastructure({
  databaseUrl,
  redisHost: redis.host,
  minioEndpoint: process.env.MINIO_ENDPOINT ?? 'minio',
  queuePrefix,
});
const storage = new MinioObjectStorageAdapter({
  endpoint: process.env.MINIO_ENDPOINT ?? 'minio',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSsl: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin123',
});
const objectKeys = new ObjectKeyService({
  originals: process.env.MINIO_ORIGINALS_BUCKET ?? 'post-originals',
  processed: process.env.MINIO_PROCESSED_BUCKET ?? 'post-processed',
  temporary: process.env.MINIO_TEMP_BUCKET ?? 'post-temporary',
});

describe('Media retry (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => prisma.onModuleInit());
  afterAll(async () => prisma.onModuleDestroy());

  beforeEach(async () => {
    const port = await availablePort();
    await withEnvironment(
      validEnvironment({ DATABASE_URL: databaseUrl, PORT: String(port) }),
      async () => {
        app = await bootstrap({
          logger: ['error', 'warn'],
          abortOnError: false,
        });
      },
    );
    await prisma.idempotencyRequest.deleteMany();
    await prisma.processingDispatch.deleteMany();
    await prisma.processingAttempt.deleteMany();
    await prisma.mediaVariant.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  afterEach(async () => app.close());

  const failedMedia = async () => {
    const post = await prisma.post.create({
      data: { title: 'Failed media post', content: 'retry fixture' },
    });
    return prisma.media.create({
      data: {
        postId: post.id,
        sortOrder: 0,
        mediaType: 'IMAGE',
        originalFilename: 'fixture.png',
        originalExtension: 'png',
        declaredMimeType: 'image/png',
        detectedMimeType: 'image/png',
        detectedFormat: 'png',
        originalBucket: 'post-originals',
        originalObjectKey: `retry/${post.id}/fixture.png`,
        originalSize: 10n,
        checksumSha256: 'a'.repeat(64),
        processingStatus: 'FAILED',
        progress: 100,
        currentStep: 'FAILED',
        processingStartedAt: new Date(Date.now() - 2_000),
        processingCompletedAt: new Date(Date.now() - 1_000),
        lastErrorCode: 'PROCESSING_FAILED',
        lastErrorMessage: 'sanitized failure',
      },
    });
  };

  it('returns MEDIA_NOT_FOUND when access is requested for missing media', async () => {
    const response = await request(app.getHttpServer()).get(
      `/api/media/${randomUUID()}/access`,
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'MEDIA_NOT_FOUND',
      message: 'The requested media does not exist.',
    });
  });

  it('transactionally resets a FAILED item and creates one generation-specific dispatch', async () => {
    const media = await failedMedia();
    const response = await request(app.getHttpServer())
      .post(`/api/media/${media.id}/retry`)
      .set('Idempotency-Key', randomUUID());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: media.id,
      processingGeneration: 2,
      processingStatus: 'PENDING',
      progress: 0,
      currentStep: 'PENDING',
    });
    expect(
      await prisma.media.findUniqueOrThrow({ where: { id: media.id } }),
    ).toMatchObject({
      processingGeneration: 2,
      processingStatus: 'PENDING',
      progress: 0,
      currentStep: 'PENDING',
      processingStartedAt: null,
      processingCompletedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    const dispatch = await prisma.processingDispatch.findUniqueOrThrow({
      where: { mediaId_generation: { mediaId: media.id, generation: 2 } },
    });
    expect(dispatch).toMatchObject({
      reason: 'MANUAL_RETRY',
      status: 'PENDING',
      jobId: mediaJobId(media.id, 2),
      publishAttempts: 0,
    });
  });

  it('replays the committed retry response without incrementing twice', async () => {
    const media = await failedMedia();
    const key = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post(`/api/media/${media.id}/retry`)
        .set('Idempotency-Key', key);

    const first = await send();
    const replay = await send();
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(
      (await prisma.media.findUniqueOrThrow({ where: { id: media.id } }))
        .processingGeneration,
    ).toBe(2);
    expect(
      await prisma.processingDispatch.count({ where: { mediaId: media.id } }),
    ).toBe(1);
  });

  it('serializes concurrent retries with different keys into one new generation', async () => {
    const media = await failedMedia();
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/media/${media.id}/retry`)
        .set('Idempotency-Key', randomUUID()),
      request(app.getHttpServer())
        .post(`/api/media/${media.id}/retry`)
        .set('Idempotency-Key', randomUUID()),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      responses.find((response) => response.status === 409)?.body.code,
    ).toBe('MEDIA_RETRY_NOT_ALLOWED');
    expect(
      (await prisma.media.findUniqueOrThrow({ where: { id: media.id } }))
        .processingGeneration,
    ).toBe(2);
    expect(
      await prisma.processingDispatch.count({ where: { mediaId: media.id } }),
    ).toBe(1);
  });

  it('rejects retry before FAILED without creating a dispatch', async () => {
    const media = await failedMedia();
    await prisma.media.update({
      where: { id: media.id },
      data: { processingStatus: 'PENDING', currentStep: 'PENDING' },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/media/${media.id}/retry`)
      .set('Idempotency-Key', randomUUID());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('MEDIA_RETRY_NOT_ALLOWED');
    expect(await prisma.processingDispatch.count()).toBe(0);
  });

  it('publishes and processes the new generation through real outbox and BullMQ paths', async () => {
    const media = await failedMedia();
    const bytes = Buffer.from(`manual-retry-original-${media.id}`);
    const originalRef = {
      bucket: media.originalBucket,
      objectKey: media.originalObjectKey,
    };
    const localRoot = await mkdtemp(join(tmpdir(), 'manual-retry-e2e-'));
    const localOriginal = join(localRoot, 'original.png');
    await writeFile(localOriginal, bytes);
    await storage.putFile(originalRef, localOriginal);
    await prisma.media.update({
      where: { id: media.id },
      data: {
        originalSize: BigInt(bytes.length),
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/media/${media.id}/retry`)
      .set('Idempotency-Key', randomUUID());
    expect(response.status).toBe(200);

    const configuration = {
      values: {
        redis,
        outbox: { maxRetryDelaySeconds: 1 },
        worker: {
          imageConcurrency: 1,
          audioConcurrency: 1,
          videoConcurrency: 1,
          mediaJobAttempts: 3,
          mediaJobBackoffMs: 25,
          processingLeaseSeconds: 5,
          processingLeaseRenewSeconds: 1,
          temporaryRoot: join(localRoot, 'worker'),
        },
      },
    } as EnvironmentConfigurationService;
    const queueOptions = {
      ...queueOptionsFor(MediaType.IMAGE, configuration.values),
      prefix: queuePrefix,
    };
    const queue = new Queue<MediaJobPayloadV1>(
      'image-processing',
      queueOptions,
    );
    const queueEvents = new QueueEvents('image-processing', queueOptions);
    const bullQueue = new BullMediaQueue(queue);
    const outboxClaims = new OutboxClaimRepository(prisma);
    const publisher = new DispatchPublicationService(
      outboxClaims,
      new PublicationBackoffService(),
      configuration,
      bullQueue,
      bullQueue,
      bullQueue,
    );
    const claims = new WorkerClaimService(prisma);
    const orchestrator = new ProcessorOrchestratorService(
      claims,
      new ProcessingWorkspaceService(configuration, storage),
      configuration,
    );
    const publication = new VariantPublicationService(
      prisma,
      storage,
      objectKeys,
    );
    let worker: Worker<MediaJobPayloadV1> | undefined;
    try {
      await queue.obliterate({ force: true });
      await queueEvents.waitUntilReady();
      worker = new Worker<MediaJobPayloadV1>(
        'image-processing',
        (job) =>
          orchestrator.execute(
            job.data,
            job.attemptsMade,
            async (claimedMedia, workspace, leaseToken, attemptId) => {
              const artifact = join(workspace, 'optimized.webp');
              await writeFile(
                artifact,
                Buffer.from(`manual-retry-${media.id}`),
              );
              await publication.publish(
                claimedMedia,
                job.data.generation,
                attemptId,
                leaseToken,
                [
                  {
                    path: artifact,
                    filename: 'optimized.webp',
                    variantType: 'OPTIMIZED_IMAGE',
                    mimeType: 'image/webp',
                    format: 'webp',
                    width: 10,
                    height: 10,
                  },
                ],
              );
            },
          ),
        queueOptions,
      );
      const [dispatch] = await outboxClaims.claimBatch(1, 5);
      expect(dispatch).toBeDefined();
      await publisher.publish(dispatch!);
      const job = await queue.getJob(mediaJobId(media.id, 2));
      expect(job).not.toBeNull();
      await job!.waitUntilFinished(queueEvents, 15_000);

      expect(
        await prisma.processingDispatch.findUniqueOrThrow({
          where: { mediaId_generation: { mediaId: media.id, generation: 2 } },
        }),
      ).toMatchObject({ status: 'PUBLISHED', reason: 'MANUAL_RETRY' });
      expect(
        await prisma.media.findUniqueOrThrow({ where: { id: media.id } }),
      ).toMatchObject({
        processingGeneration: 2,
        processingStatus: 'COMPLETED',
      });
      expect(
        await prisma.processingAttempt.count({
          where: { mediaId: media.id, generation: 2 },
        }),
      ).toBe(1);
      expect(
        await prisma.mediaVariant.count({ where: { mediaId: media.id } }),
      ).toBe(1);
    } finally {
      await worker?.close(true);
      await Promise.all([queueEvents.close(), bullQueue.close()]);
      await storage.remove(originalRef).catch(() => undefined);
      await rm(localRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
