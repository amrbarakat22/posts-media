import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import * as request from 'supertest';

import { bootstrap } from '../../apps/api/src/main';
import { validEnvironment, withEnvironment } from '../support/environment';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://posts:posts@postgres:5432/posts_media_test';

const prisma = new PrismaService(databaseUrl);

const insertPostWithMedia = async (
  processingStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
  mediaType: 'IMAGE' | 'AUDIO' | 'VIDEO' = 'IMAGE',
) => {
  const post = await prisma.post.create({
    data: { title: 'Fixture with media', content: 'fixture' },
  });
  await prisma.media.create({
    data: {
      postId: post.id,
      sortOrder: 0,
      mediaType,
      processingStatus,
      originalFilename: 'fixture.png',
      originalExtension: 'png',
      declaredMimeType: 'image/png',
      detectedMimeType: 'image/png',
      detectedFormat: 'png',
      originalBucket: 'post-originals',
      originalObjectKey: `fixtures/${post.id}/0.png`,
      originalSize: 1024n,
      checksumSha256: 'a'.repeat(64),
    },
  });
  return post;
};

describe('Posts E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await withEnvironment(
      validEnvironment({ DATABASE_URL: databaseUrl, PORT: '0' }),
      async () => {
        app = await bootstrap({ logger: false });
      },
    );
    await prisma.idempotencyRequest.deleteMany();
    await prisma.processingDispatch.deleteMany();
    await prisma.processingAttempt.deleteMany();
    await prisma.mediaVariant.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('creates a post from a JSON body and returns the presented shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Hello world', content: 'Body text' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      title: 'Hello world',
      content: 'Body text',
      aggregateStatus: 'NO_MEDIA',
      mediaCount: 0,
      media: [],
      deletedAt: null,
    });
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body.links).toEqual({
      self: `/api/posts/${response.body.id}`,
    });
  });

  it('rejects a create request missing a required field', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .send({ content: 'no title' });

    expect(response.status).toBe(400);
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it('gets a single post by id and 404s for an unknown id', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Get me', content: 'Body' });

    const found = await request(app.getHttpServer()).get(
      `/api/posts/${created.body.id}`,
    );
    expect(found.status).toBe(200);
    expect(found.body.id).toBe(created.body.id);

    const missing = await request(app.getHttpServer()).get(
      '/api/posts/00000000-0000-0000-0000-000000000000',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('POST_NOT_FOUND');
  });

  it('updates only title/content via PATCH', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Original title', content: 'Original content' });

    const updated = await request(app.getHttpServer())
      .patch(`/api/posts/${created.body.id}`)
      .send({ title: 'New title' });

    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('New title');
    expect(updated.body.content).toBe('Original content');
  });

  it('soft-deletes a post: excluded from default get/list, visible with includeDeleted, restorable', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Delete me', content: 'Body' });
    const postId = created.body.id as string;

    const deleted = await request(app.getHttpServer()).delete(
      `/api/posts/${postId}`,
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedAt).toEqual(expect.any(String));

    const getAfterDelete = await request(app.getHttpServer()).get(
      `/api/posts/${postId}`,
    );
    expect(getAfterDelete.status).toBe(409);
    expect(getAfterDelete.body.code).toBe('POST_SOFT_DELETED');

    const listDefault = await request(app.getHttpServer()).get('/api/posts');
    expect(
      (listDefault.body.data as Array<{ id: string }>).some(
        (post) => post.id === postId,
      ),
    ).toBe(false);

    const listIncludingDeleted = await request(app.getHttpServer()).get(
      '/api/posts?includeDeleted=true',
    );
    expect(
      (listIncludingDeleted.body.data as Array<{ id: string }>).some(
        (post) => post.id === postId,
      ),
    ).toBe(true);

    const restored = await request(app.getHttpServer()).post(
      `/api/posts/${postId}/restore`,
    );
    expect(restored.status).toBe(200);
    expect(restored.body.deletedAt).toBeNull();

    const getAfterRestore = await request(app.getHttpServer()).get(
      `/api/posts/${postId}`,
    );
    expect(getAfterRestore.status).toBe(200);
  });

  it('paginates results honoring page/pageSize and reports totals', async () => {
    for (let index = 0; index < 5; index += 1) {
      await request(app.getHttpServer())
        .post('/api/posts')
        .send({ title: `Post ${index}`, content: 'Body' });
    }

    const page1 = await request(app.getHttpServer()).get(
      '/api/posts?page=1&pageSize=2',
    );
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      totalItems: 5,
      totalPages: 3,
    });

    const page3 = await request(app.getHttpServer()).get(
      '/api/posts?page=3&pageSize=2',
    );
    expect(page3.body.data).toHaveLength(1);
  });

  it('filters by case-insensitive search across title and content', async () => {
    await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Sunset Photography', content: 'landscape' });
    await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Unrelated', content: 'mentions SUNSET here' });
    await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'Nothing matching', content: 'no overlap' });

    const response = await request(app.getHttpServer()).get(
      '/api/posts?search=sunset',
    );
    expect(response.body.data).toHaveLength(2);
  });

  it('filters by mediaType and processingStatus using included media', async () => {
    const completedImage = await insertPostWithMedia('COMPLETED', 'IMAGE');
    await insertPostWithMedia('PENDING', 'AUDIO');

    const response = await request(app.getHttpServer()).get(
      '/api/posts?mediaType=IMAGE&processingStatus=COMPLETED',
    );

    const ids = (response.body.data as Array<{ id: string }>).map(
      (post) => post.id,
    );
    expect(ids).toEqual([completedImage.id]);
  });

  it('sorts by the requested field and order', async () => {
    await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'B post', content: 'x' });
    await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'A post', content: 'x' });

    const response = await request(app.getHttpServer()).get(
      '/api/posts?sortBy=title&sortOrder=asc',
    );

    const titles = (response.body.data as Array<{ title: string }>).map(
      (post) => post.title,
    );
    expect(titles).toEqual(['A post', 'B post']);
  });
});
