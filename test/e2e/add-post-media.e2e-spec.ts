import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import { ObjectKeyService, OBJECT_STORAGE_PORT } from '@posts-media/storage';
import type { ObjectStoragePort } from '@posts-media/storage';
import * as request from 'supertest';

import { bootstrap } from '../../apps/api/src/main';
import { validEnvironment, withEnvironment } from '../support/environment';

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
const originalsBucket = process.env.MINIO_ORIGINALS_BUCKET ?? 'post-originals';
const processedBucket = process.env.MINIO_PROCESSED_BUCKET ?? 'post-processed';
const temporaryBucket = process.env.MINIO_TEMP_BUCKET ?? 'post-temporary';

const prisma = new PrismaService(databaseUrl);
const objectKeys = new ObjectKeyService({
  originals: originalsBucket,
  processed: processedBucket,
  temporary: temporaryBucket,
});

describe('Add media to an existing post (e2e)', () => {
  let app: INestApplication;
  let storage: ObjectStoragePort;
  let fixtures: string;
  let imageA: string;
  let imageB: string;
  let fakeVideo: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    fixtures = await mkdtemp(join(tmpdir(), 'add-post-media-'));
    for (const name of ['a.jpg', 'b.jpg']) {
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=#998877:s=6x4',
          '-frames:v',
          '1',
          '-c:v',
          'mjpeg',
          name,
        ],
        { cwd: fixtures },
      );
    }
    imageA = join(fixtures, 'a.jpg');
    imageB = join(fixtures, 'b.jpg');
    fakeVideo = join(fixtures, 'fake.mp4');
    await writeFile(fakeVideo, await readFile(imageA));
  });

  afterAll(async () => {
    await rm(fixtures, { recursive: true, force: true });
    await prisma.onModuleDestroy();
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
    storage = app.get<ObjectStoragePort>(OBJECT_STORAGE_PORT);
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

  const createPost = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Idempotency-Key', randomUUID())
      .send({ title: 'Target post', content: 'x' });
    return response.body.id as string;
  };

  it('accepts valid files and reports a signature mismatch as rejected (partial success)', async () => {
    const postId = await createPost();

    const response = await request(app.getHttpServer())
      .post(`/api/posts/${postId}/media`)
      .set('Idempotency-Key', randomUUID())
      .attach('media', imageA)
      .attach('media', imageB)
      .attach('media', fakeVideo, {
        contentType: 'video/mp4',
        filename: 'fake.mp4',
      });

    expect(response.status).toBe(201);
    expect(response.body.summary).toEqual({
      submitted: 3,
      accepted: 2,
      rejected: 1,
    });
    expect(response.body.accepted).toHaveLength(2);
    expect(response.body.rejected).toHaveLength(1);
    expect(response.body.rejected[0].code).toBe('FILE_SIGNATURE_MISMATCH');

    const media = await prisma.media.findMany({ where: { postId } });
    expect(media).toHaveLength(2);
    expect(media.map((item) => item.sortOrder).sort()).toEqual([0, 1]);

    for (const item of media) {
      const exists = await storage.exists(
        objectKeys.originalKey(postId, item.id, item.originalExtension),
      );
      expect(exists).toBe(true);
    }

    const dispatches = await prisma.processingDispatch.count();
    expect(dispatches).toBe(2);
  });

  it('returns 422 and creates no media when every file is invalid', async () => {
    const postId = await createPost();

    const response = await request(app.getHttpServer())
      .post(`/api/posts/${postId}/media`)
      .set('Idempotency-Key', randomUUID())
      .attach('media', fakeVideo, {
        contentType: 'video/mp4',
        filename: 'fake.mp4',
      });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('POST_MEDIA_VALIDATION_FAILED');
    expect(await prisma.media.count()).toBe(0);
  });

  it('allocates increasing sortOrder across two sequential add-media calls', async () => {
    const postId = await createPost();

    await request(app.getHttpServer())
      .post(`/api/posts/${postId}/media`)
      .set('Idempotency-Key', randomUUID())
      .attach('media', imageA)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/posts/${postId}/media`)
      .set('Idempotency-Key', randomUUID())
      .attach('media', imageB)
      .expect(201);

    const media = await prisma.media.findMany({
      where: { postId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(media.map((item) => item.sortOrder)).toEqual([0, 1]);
  });

  it('returns 404 for a nonexistent post', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/posts/00000000-0000-0000-0000-000000000000/media`)
      .set('Idempotency-Key', randomUUID())
      .attach('media', imageA);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('POST_NOT_FOUND');
  });

  it('returns 409 for a soft-deleted post', async () => {
    const postId = await createPost();
    await request(app.getHttpServer()).delete(`/api/posts/${postId}`);

    const response = await request(app.getHttpServer())
      .post(`/api/posts/${postId}/media`)
      .set('Idempotency-Key', randomUUID())
      .attach('media', imageA);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('POST_SOFT_DELETED');
  });

  it('serializes concurrent add-media requests so sortOrder never collides', async () => {
    const postId = await createPost();

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/posts/${postId}/media`)
        .set('Idempotency-Key', randomUUID())
        .attach('media', imageA),
      request(app.getHttpServer())
        .post(`/api/posts/${postId}/media`)
        .set('Idempotency-Key', randomUUID())
        .attach('media', imageB),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const media = await prisma.media.findMany({ where: { postId } });
    expect(media).toHaveLength(2);
    expect(new Set(media.map((item) => item.sortOrder))).toEqual(
      new Set([0, 1]),
    );
  });

  it('replays the exact original response for a repeated idempotency key', async () => {
    const postId = await createPost();
    const idempotencyKey = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post(`/api/posts/${postId}/media`)
        .set('Idempotency-Key', idempotencyKey)
        .attach('media', imageA);

    const first = await send();
    expect(first.status).toBe(201);
    const second = await send();
    expect(second.body).toEqual(first.body);

    expect(await prisma.media.count()).toBe(1);
  });
});
