import { randomUUID } from 'node:crypto';

import { PrismaService } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';
import { jobNameFor, mediaJobId, queueNameFor } from '@posts-media/queues';

import { OutboxClaimRepository } from '../../apps/worker/src/outbox/outbox-claim.repository';
import { assertTestInfrastructure } from '../support/test-infrastructure.guard';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL must be set for outbox integration tests');
}
assertTestInfrastructure({ databaseUrl });

describe('OutboxClaimRepository', () => {
  const prisma = new PrismaService(databaseUrl);
  const repository = new OutboxClaimRepository(prisma);

  beforeAll(async () => prisma.onModuleInit());
  afterAll(async () => prisma.onModuleDestroy());

  beforeEach(async () => {
    await prisma.processingDispatch.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  it('claims disjoint rows when two dispatchers race with SKIP LOCKED', async () => {
    const post = await prisma.post.create({
      data: { title: 'Outbox race', content: 'claim test' },
    });
    for (let index = 0; index < 4; index += 1) {
      const media = await prisma.media.create({
        data: {
          postId: post.id,
          sortOrder: index,
          mediaType: MediaType.IMAGE,
          originalFilename: `${index}.png`,
          originalExtension: 'png',
          declaredMimeType: 'image/png',
          detectedMimeType: 'image/png',
          detectedFormat: 'png',
          originalBucket: 'post-originals',
          originalObjectKey: `outbox/${post.id}/${index}.png`,
          originalSize: 10n,
          checksumSha256: String(index).padStart(64, '0'),
        },
      });
      const dispatchId = randomUUID();
      await prisma.processingDispatch.create({
        data: {
          id: dispatchId,
          mediaId: media.id,
          generation: 1,
          reason: 'INITIAL_UPLOAD',
          queueName: queueNameFor(MediaType.IMAGE),
          jobName: jobNameFor(MediaType.IMAGE),
          jobId: mediaJobId(media.id, 1),
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
    }

    const [first, second] = await Promise.all([
      repository.claimBatch(2, 30),
      repository.claimBatch(2, 30),
    ]);
    const firstIds = first.map((item) => item.id);
    const secondIds = second.map((item) => item.id);

    expect(firstIds).toHaveLength(2);
    expect(secondIds).toHaveLength(2);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
  });
});
