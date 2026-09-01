import { randomUUID } from 'node:crypto';

import { PrismaService } from '@posts-media/database';
import { MediaType } from '@posts-media/domain';

import { WorkerClaimService } from '../../apps/worker/src/processing/worker-claim.service';
import { assertTestInfrastructure } from '../support/test-infrastructure.guard';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error(
    'DATABASE_URL must be set for worker claim integration tests',
  );
}
assertTestInfrastructure({ databaseUrl });

describe('WorkerClaimService', () => {
  const prisma = new PrismaService(databaseUrl);
  const service = new WorkerClaimService(prisma);

  beforeAll(async () => prisma.onModuleInit());
  afterAll(async () => prisma.onModuleDestroy());
  beforeEach(async () => {
    await prisma.processingDispatch.deleteMany();
    await prisma.processingAttempt.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  it('allows one active claim, rejects duplicates, and recovers an expired lease', async () => {
    const post = await prisma.post.create({
      data: { title: 'claim', content: '' },
    });
    const media = await prisma.media.create({
      data: {
        postId: post.id,
        sortOrder: 0,
        mediaType: MediaType.IMAGE,
        originalFilename: 'x.png',
        originalExtension: 'png',
        declaredMimeType: 'image/png',
        detectedMimeType: 'image/png',
        detectedFormat: 'png',
        originalBucket: 'post-originals',
        originalObjectKey: 'claim/x.png',
        originalSize: 1n,
        checksumSha256: 'a'.repeat(64),
      },
    });
    const firstToken = randomUUID();
    const first = await service.claim(media.id, 1, 'job-1', 60, firstToken);
    expect(first?.leaseToken).toBe(firstToken);
    await expect(
      service.claim(media.id, 1, 'job-2', 60, randomUUID()),
    ).resolves.toBeNull();

    await prisma.media.update({
      where: { id: media.id },
      data: { processingLeaseExpiresAt: new Date(Date.now() - 1000) },
    });
    const recovered = await service.claim(
      media.id,
      1,
      'job-3',
      60,
      randomUUID(),
    );
    expect(recovered).not.toBeNull();
  });
});
