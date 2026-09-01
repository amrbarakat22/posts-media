import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import * as request from 'supertest';

import { bootstrap } from '../../apps/api/src/main';
import { validEnvironment, withEnvironment } from '../support/environment';
import { assertTestInfrastructure } from '../support/test-infrastructure.guard';

/** Resolves a free TCP port on 127.0.0.1 — `PORT=0` fails the env schema's `min: 1` port check. */
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
assertTestInfrastructure({ databaseUrl });

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

  const createPost = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/posts')
      .set('Idempotency-Key', randomUUID())
      .send(body);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

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

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('creates a post from a JSON body and returns the presented shape', async () => {
    const response = await createPost({
      title: 'Hello world',
      content: 'Body text',
    });

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
    const response = await createPost({ content: 'no title' });

    expect(response.status).toBe(400);
    expect(response.body.requestId).toEqual(expect.any(String));
  });

  it('gets a single post by id and 404s for an unknown id', async () => {
    const created = await createPost({ title: 'Get me', content: 'Body' });

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
    const created = await createPost({
      title: 'Original title',
      content: 'Original content',
    });

    const updated = await request(app.getHttpServer())
      .patch(`/api/posts/${created.body.id}`)
      .send({ title: 'New title' });

    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe('New title');
    expect(updated.body.content).toBe('Original content');
  });

  it('soft-deletes a post: excluded from default get/list, visible with includeDeleted, restorable', async () => {
    const created = await createPost({ title: 'Delete me', content: 'Body' });
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
      await createPost({ title: `Post ${index}`, content: 'Body' });
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
    await createPost({ title: 'Sunset Photography', content: 'landscape' });
    await createPost({ title: 'Unrelated', content: 'mentions SUNSET here' });
    await createPost({ title: 'Nothing matching', content: 'no overlap' });

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
    await createPost({ title: 'B post', content: 'x' });
    await createPost({ title: 'A post', content: 'x' });

    const response = await request(app.getHttpServer()).get(
      '/api/posts?sortBy=title&sortOrder=asc',
    );

    const titles = (response.body.data as Array<{ title: string }>).map(
      (post) => post.title,
    );
    expect(titles).toEqual(['A post', 'B post']);
  });

  it('rejects a title over 200 characters', async () => {
    const response = await createPost({ title: 'a'.repeat(201), content: 'x' });

    expect(response.status).toBe(400);
  });

  it('rejects content over 10,000 characters', async () => {
    const response = await createPost({
      title: 'ok',
      content: 'a'.repeat(10001),
    });

    expect(response.status).toBe(400);
  });

  it('rejects unknown body fields', async () => {
    const response = await createPost({
      title: 'ok',
      content: 'x',
      unexpected: true,
    });

    expect(response.status).toBe(400);
  });

  it('treats delete and restore as idempotent when repeated', async () => {
    const created = await createPost({ title: 'Twice', content: 'x' });
    const postId = created.body.id as string;

    await request(app.getHttpServer())
      .delete(`/api/posts/${postId}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/posts/${postId}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/posts/${postId}/restore`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/posts/${postId}/restore`)
      .expect(200);
  });

  it('returns 404 when deleting or restoring an unknown post', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .delete(`/api/posts/${missing}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/posts/${missing}/restore`)
      .expect(404);
  });

  it('filters by createdFrom/createdTo date range', async () => {
    await createPost({ title: 'InRange', content: 'x' });

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const inRange = await request(app.getHttpServer()).get(
      `/api/posts?createdFrom=${from}&createdTo=${to}`,
    );
    expect(inRange.body.data.length).toBeGreaterThanOrEqual(1);

    const farFuture = new Date(Date.now() + 3_600_000).toISOString();
    const empty = await request(app.getHttpServer()).get(
      `/api/posts?createdFrom=${farFuture}`,
    );
    expect(empty.body.data).toHaveLength(0);
  });
});
