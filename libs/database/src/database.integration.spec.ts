import { Prisma } from '@prisma/client';

import { PrismaService } from './prisma.service';

const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL must be set for database integration tests');
}

const uniqueConstraint = expect.objectContaining({ code: 'P2002' });

describe('Prisma persistence constraints', () => {
  const prisma = new PrismaService(databaseUrl);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await prisma.idempotencyRequest.deleteMany();
    await prisma.processingDispatch.deleteMany();
    await prisma.processingAttempt.deleteMany();
    await prisma.mediaVariant.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const createPost = () =>
    prisma.post.create({
      data: { title: 'Constraint fixture', content: 'Persistence contract' },
    });

  const createMedia = (postId: string, sortOrder = 0) =>
    prisma.media.create({
      data: {
        postId,
        sortOrder,
        mediaType: 'IMAGE',
        originalFilename: 'fixture.png',
        originalExtension: 'png',
        declaredMimeType: 'image/png',
        detectedMimeType: 'image/png',
        detectedFormat: 'png',
        originalBucket: 'post-originals',
        originalObjectKey: `fixtures/${postId}/${sortOrder}.png`,
        originalSize: 1024n,
        checksumSha256: 'a'.repeat(64),
      },
    });

  it('enforces the media post sort-order unique constraint', async () => {
    const post = await createPost();
    await createMedia(post.id);

    await expect(createMedia(post.id)).rejects.toEqual(uniqueConstraint);
  });

  it('enforces the media variant profile/type unique constraint', async () => {
    const post = await createPost();
    const media = await createMedia(post.id);
    const data = {
      mediaId: media.id,
      processingProfile: 'balanced-v1',
      variantType: 'OPTIMIZED_IMAGE' as const,
      bucket: 'post-processed',
      objectKey: `fixtures/${media.id}/optimized.webp`,
      mimeType: 'image/webp',
      format: 'webp',
      size: 512n,
      checksumSha256: 'b'.repeat(64),
    };

    await prisma.mediaVariant.create({ data });

    await expect(prisma.mediaVariant.create({ data })).rejects.toEqual(
      uniqueConstraint,
    );
  });

  it('enforces dispatch generation and job-id unique constraints', async () => {
    const post = await createPost();
    const firstMedia = await createMedia(post.id, 0);
    const secondMedia = await createMedia(post.id, 1);
    const firstDispatch = {
      mediaId: firstMedia.id,
      generation: 1,
      reason: 'INITIAL_UPLOAD' as const,
      queueName: 'media-processing',
      jobName: 'process-image',
      jobId: 'media-generation-1',
      payload: { mediaId: firstMedia.id, generation: 1 },
    };

    await prisma.processingDispatch.create({ data: firstDispatch });

    await expect(
      prisma.processingDispatch.create({
        data: { ...firstDispatch, jobId: 'another-job-id' },
      }),
    ).rejects.toEqual(uniqueConstraint);
    await expect(
      prisma.processingDispatch.create({
        data: {
          ...firstDispatch,
          mediaId: secondMedia.id,
          jobId: firstDispatch.jobId,
        },
      }),
    ).rejects.toEqual(uniqueConstraint);
  });

  it('enforces the idempotency key unique constraint', async () => {
    const data = {
      key: 'same-create-post-request',
      operation: 'CREATE_POST' as const,
      method: 'POST',
      routeTemplate: '/posts',
      state: 'IN_PROGRESS' as const,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await prisma.idempotencyRequest.create({ data });

    await expect(prisma.idempotencyRequest.create({ data })).rejects.toEqual(
      uniqueConstraint,
    );
  });

  it('rolls back all writes when the transaction callback fails', async () => {
    const title = 'Must be rolled back';

    await expect(
      prisma.withTransaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.post.create({
          data: { title, content: 'This write must not survive' },
        });
        throw new Error('rollback sentinel');
      }),
    ).rejects.toThrow('rollback sentinel');

    await expect(prisma.post.count({ where: { title } })).resolves.toBe(0);
  });
});
