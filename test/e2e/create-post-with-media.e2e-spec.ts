import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { ObjectKeyService } from '@posts-media/storage';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
} from '@posts-media/storage';
import { PrismaService } from '@posts-media/database';
import * as request from 'supertest';

import { bootstrap } from '../../apps/api/src/main';
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
assertTestInfrastructure({
  databaseUrl,
  minioEndpoint: process.env.MINIO_ENDPOINT ?? 'minio',
});
const originalsBucket = process.env.MINIO_ORIGINALS_BUCKET ?? 'post-originals';
const processedBucket = process.env.MINIO_PROCESSED_BUCKET ?? 'post-processed';
const temporaryBucket = process.env.MINIO_TEMP_BUCKET ?? 'post-temporary';

const prisma = new PrismaService(databaseUrl);
const objectKeys = new ObjectKeyService({
  originals: originalsBucket,
  processed: processedBucket,
  temporary: temporaryBucket,
});

const ffmpeg = (directory: string, args: readonly string[]): void => {
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    {
      cwd: directory,
    },
  );
};

describe('Create post with initial media (e2e)', () => {
  let app: INestApplication;
  let storage: ObjectStoragePort;
  let fixtures: string;
  let validImagePath: string;
  let validAudioPath: string;
  let validVideoPath: string;
  let fakeVideoPath: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    fixtures = await mkdtemp(join(tmpdir(), 'create-post-media-'));

    ffmpeg(fixtures, [
      '-f',
      'lavfi',
      '-i',
      'color=c=#336699:s=6x4',
      '-frames:v',
      '1',
      '-c:v',
      'mjpeg',
      'valid.jpg',
    ]);
    ffmpeg(fixtures, [
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=800:duration=1.0',
      '-c:a',
      'libmp3lame',
      'valid.mp3',
    ]);
    ffmpeg(fixtures, [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=16x12:r=10:d=1.0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      'valid.mp4',
    ]);
    validImagePath = join(fixtures, 'valid.jpg');
    validAudioPath = join(fixtures, 'valid.mp3');
    validVideoPath = join(fixtures, 'valid.mp4');

    // A real JPEG's bytes saved under a .mp4 extension — declared/claimed as
    // video/mp4 but the signature/container check will catch the mismatch.
    fakeVideoPath = join(fixtures, 'fake-video.mp4');
    await writeFile(fakeVideoPath, await readFile(validImagePath));
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

  it('atomically rejects the whole request when one initial file is invalid, creating nothing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Idempotency-Key', randomUUID())
      .field('title', 'Mixed valid and invalid')
      .field('content', 'One good image, one spoofed video')
      .attach('media', validImagePath)
      .attach('media', fakeVideoPath, { contentType: 'video/mp4' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('POST_MEDIA_VALIDATION_FAILED');
    expect(response.body.details.rejected).toHaveLength(1);

    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.media.count()).toBe(0);
    expect(await prisma.processingDispatch.count()).toBe(0);
  });

  it('creates one post with three mixed media, three originals, and three PENDING dispatches', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Idempotency-Key', randomUUID())
      .field('title', 'Mixed media post')
      .field('content', 'One image, one audio, one video')
      .attach('media', validImagePath)
      .attach('media', validAudioPath)
      .attach('media', validVideoPath);

    expect(response.status).toBe(201);
    expect(response.body.mediaCount).toBe(3);
    expect(response.body.aggregateStatus).toBe('PENDING');
    const mediaTypes = (
      response.body.media as Array<{
        mediaType: string;
        processingStatus: string;
      }>
    ).map((media) => media.mediaType);
    expect(new Set(mediaTypes)).toEqual(new Set(['IMAGE', 'AUDIO', 'VIDEO']));

    const postId = response.body.id as string;
    const posts = await prisma.post.count();
    expect(posts).toBe(1);

    const media = await prisma.media.findMany({ where: { postId } });
    expect(media).toHaveLength(3);
    for (const item of media) {
      expect(item.processingStatus).toBe('PENDING');
      expect(item.processingGeneration).toBe(1);
      const exists = await storage.exists(
        objectKeys.originalKey(postId, item.id, item.originalExtension),
      );
      expect(exists).toBe(true);
    }

    const dispatches = await prisma.processingDispatch.findMany({
      where: { mediaId: { in: media.map((item) => item.id) } },
    });
    expect(dispatches).toHaveLength(3);
    for (const dispatch of dispatches) {
      expect(dispatch.status).toBe('PENDING');
      expect(dispatch.generation).toBe(1);
      expect(dispatch.reason).toBe('INITIAL_UPLOAD');
      expect(dispatch.jobId).toBe(`media-${dispatch.mediaId}-generation-1`);
    }
    const queueNames = new Set(
      dispatches.map((dispatch) => dispatch.queueName),
    );
    expect(queueNames).toEqual(
      new Set(['image-processing', 'audio-processing', 'video-processing']),
    );
  });

  it('replays the exact original response for a repeated idempotency key, creating nothing new', async () => {
    const idempotencyKey = randomUUID();
    const send = () =>
      request(app.getHttpServer())
        .post('/api/posts')
        .set('Idempotency-Key', idempotencyKey)
        .field('title', 'Replay me')
        .field('content', 'Same request twice')
        .attach('media', validImagePath);

    const first = await send();
    expect(first.status).toBe(201);

    const second = await send();
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);

    expect(await prisma.post.count()).toBe(1);
    expect(await prisma.media.count()).toBe(1);
    expect(await prisma.processingDispatch.count()).toBe(1);
  });

  it('rejects a different request reusing the same idempotency key with 409', async () => {
    const idempotencyKey = randomUUID();
    const first = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Idempotency-Key', idempotencyKey)
      .send({ title: 'First', content: 'x' });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/api/posts')
      .set('Idempotency-Key', idempotencyKey)
      .send({ title: 'Different', content: 'y' });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.post.count()).toBe(1);
  });

  it('requires an Idempotency-Key header', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/posts')
      .send({ title: 'No key', content: 'x' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
