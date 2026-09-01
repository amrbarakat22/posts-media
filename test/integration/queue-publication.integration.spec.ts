import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import type { EnvironmentConfigurationService } from '@posts-media/configuration';
import { PrismaService } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import {
  BullMediaQueue,
  jobNameFor,
  mediaJobId,
  queueNameFor,
  queueOptionsFor,
} from '@posts-media/queues';

import { DispatchPublicationService } from '../../apps/worker/src/outbox/dispatch-publication.service';
import { OutboxClaimRepository } from '../../apps/worker/src/outbox/outbox-claim.repository';
import { PublicationBackoffService } from '../../apps/worker/src/outbox/publication-backoff.service';
import { assertTestInfrastructure } from '../support/test-infrastructure.guard';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://posts:posts@postgres:5432/posts_media_test';
const redisHost = process.env.REDIS_HOST ?? 'redis';
const queuePrefix = `posts-media-test:publication:${randomUUID()}`;
assertTestInfrastructure({ databaseUrl, redisHost, queuePrefix });
const prisma = new PrismaService(databaseUrl);

describe('BullMQ publication integration', () => {
  const queue = new Queue('image-processing', {
    ...queueOptionsFor(MediaType.IMAGE, {
      redis: { host: redisHost, port: 6379 },
      worker: {
        imageConcurrency: 4,
        audioConcurrency: 2,
        videoConcurrency: 1,
        mediaJobAttempts: 3,
        mediaJobBackoffMs: 5000,
      },
    }),
    prefix: queuePrefix,
  });
  const bullQueue = new BullMediaQueue(queue);

  beforeAll(async () => prisma.onModuleInit());
  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await bullQueue.close();
    await prisma.onModuleDestroy();
  });

  it('publishes and deduplicates a deterministic job id', async () => {
    const payload = {
      payloadVersion: 1 as const,
      dispatchId: '00000000-0000-0000-0000-000000000001',
      mediaId: '00000000-0000-0000-0000-000000000002',
      postId: '00000000-0000-0000-0000-000000000003',
      mediaType: MediaType.IMAGE,
      generation: 1,
      processingProfile: 'balanced-v1' as const,
      reason: 'INITIAL_UPLOAD' as const,
    };
    const jobId = mediaJobId(payload.mediaId, payload.generation);

    const first = await queue.add(jobNameFor(MediaType.IMAGE), payload, {
      jobId,
    });
    const second = await queue.add(jobNameFor(MediaType.IMAGE), payload, {
      jobId,
    });

    expect(first.id).toBe(jobId);
    expect(second.id).toBe(jobId);
    expect(await queue.getJobCounts('waiting', 'active')).toEqual({
      waiting: 1,
      active: 0,
      paused: 0,
    });
  });

  it('reclaims after queue success and DB finalization failure without duplicating the job', async () => {
    await prisma.processingDispatch.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
    const post = await prisma.post.create({
      data: { title: 'Outbox finalization', content: 'integration fixture' },
    });
    const media = await prisma.media.create({
      data: {
        postId: post.id,
        sortOrder: 0,
        mediaType: MediaType.IMAGE,
        originalFilename: 'fixture.png',
        originalExtension: 'png',
        declaredMimeType: 'image/png',
        detectedMimeType: 'image/png',
        detectedFormat: 'png',
        originalBucket: 'post-originals',
        originalObjectKey: `publication/${post.id}/fixture.png`,
        originalSize: 1n,
        checksumSha256: 'a'.repeat(64),
      },
    });
    const dispatchId = randomUUID();
    const jobId = mediaJobId(media.id, 1);
    await prisma.processingDispatch.create({
      data: {
        id: dispatchId,
        mediaId: media.id,
        generation: 1,
        reason: 'INITIAL_UPLOAD',
        queueName: queueNameFor(MediaType.IMAGE),
        jobName: jobNameFor(MediaType.IMAGE),
        jobId,
        payload: {
          payloadVersion: 1,
          dispatchId,
          mediaId: media.id,
          postId: post.id,
          mediaType: MediaType.IMAGE,
          generation: 1,
          processingProfile: 'balanced-v1',
          reason: 'INITIAL_UPLOAD',
        },
      },
    });
    const claims = new OutboxClaimRepository(prisma);
    const publisher = new DispatchPublicationService(
      claims,
      new PublicationBackoffService(),
      {
        values: { outbox: { maxRetryDelaySeconds: 1 } },
      } as EnvironmentConfigurationService,
      bullQueue,
      bullQueue,
      bullQueue,
    );
    const markPublished = jest
      .spyOn(claims, 'markPublished')
      .mockRejectedValueOnce(new Error('POSTGRES_FINALIZATION_FAILED'));
    try {
      const [first] = await claims.claimBatch(1, 5);
      await publisher.publish(first!);
      expect(
        await prisma.processingDispatch.findUniqueOrThrow({
          where: { id: dispatchId },
        }),
      ).toMatchObject({
        status: 'RETRY_WAIT',
        publishAttempts: 1,
        lastErrorCode: 'OUTBOX_FINALIZATION_FAILED',
      });

      await prisma.processingDispatch.update({
        where: { id: dispatchId },
        data: { nextAttemptAt: new Date(Date.now() - 1) },
      });
      const [reclaimed] = await claims.claimBatch(1, 5);
      await publisher.publish(reclaimed!);

      expect(
        await prisma.processingDispatch.findUniqueOrThrow({
          where: { id: dispatchId },
        }),
      ).toMatchObject({ status: 'PUBLISHED', publishAttempts: 1 });
      expect(markPublished).toHaveBeenCalledTimes(2);
      expect((await queue.getJob(jobId))?.id).toBe(jobId);
      expect(await queue.getJobCountByTypes('waiting')).toBe(1);
    } finally {
      markPublished.mockRestore();
      await prisma.processingDispatch.deleteMany();
      await prisma.media.deleteMany();
      await prisma.post.deleteMany();
    }
  });
});
