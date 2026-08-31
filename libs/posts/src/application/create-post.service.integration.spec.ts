import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IdempotencyService, PrismaService } from '@posts-media/database';
import { DomainError } from '@posts-media/domain';
import { MediaRepository, MediaValidationService } from '@posts-media/media';
import {
  MinioObjectStorageAdapter,
  ObjectKeyService,
  type ObjectRef,
  type ObjectStoragePort,
  type StoredObject,
} from '@posts-media/storage';

import { CreatePostService } from './create-post.service';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://posts:posts@postgres:5432/posts_media_test';
const endpoint = process.env.MINIO_ENDPOINT ?? 'minio';
const port = Number(process.env.MINIO_PORT ?? '9000');
const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin123';
const originalsBucket = process.env.MINIO_ORIGINALS_BUCKET ?? 'post-originals';
const processedBucket = process.env.MINIO_PROCESSED_BUCKET ?? 'post-processed';
const temporaryBucket = process.env.MINIO_TEMP_BUCKET ?? 'post-temporary';

const prisma = new PrismaService(databaseUrl);
const idempotency = new IdempotencyService(prisma, 24, 900);
const mediaValidation = new MediaValidationService({
  temporaryRoot: '/unused',
  temporaryMaxAgeMinutes: 60,
  maxFilesPerRequest: 10,
  maxTotalUploadSizeMb: 500,
  maxImageSizeMb: 10,
  maxAudioSizeMb: 50,
  maxVideoSizeMb: 250,
  maxImagePixels: 40_000_000,
  maxAudioDurationSeconds: 7_200,
  maxVideoDurationSeconds: 1_800,
  maxVideoWidth: 7_680,
  maxVideoHeight: 4_320,
  maxMediaStreams: 10,
  mediaProbeTimeoutMs: 10_000,
});
const mediaRepository = new MediaRepository();
const objectKeys = new ObjectKeyService({
  originals: originalsBucket,
  processed: processedBucket,
  temporary: temporaryBucket,
});
const realStorage = new MinioObjectStorageAdapter({
  endpoint,
  port,
  useSsl: false,
  accessKey,
  secretKey,
});

const multerFile = (path: string, originalname: string, mimetype: string) =>
  ({ path, originalname, mimetype, fieldname: 'media' }) as Express.Multer.File;

/** A storage port that fails `copy()` on its Nth call, tracking every ref it was asked to remove. */
class FailingCopyStorage implements ObjectStoragePort {
  public readonly removedRefs: ObjectRef[] = [];
  private calls = 0;

  public constructor(private readonly failOnCallNumber: number) {}

  public async putFile(ref: ObjectRef): Promise<StoredObject> {
    return { ...ref, sizeBytes: 1n };
  }

  public async copy(
    _source: ObjectRef,
    destination: ObjectRef,
  ): Promise<StoredObject> {
    this.calls += 1;
    if (this.calls === this.failOnCallNumber) {
      throw new Error('simulated MinIO promotion failure');
    }
    return { ...destination, sizeBytes: 1n };
  }

  public async stat(ref: ObjectRef): Promise<StoredObject> {
    return { ...ref, sizeBytes: 1n };
  }

  public async downloadToFile(): Promise<void> {
    /* unused in this test */
  }

  public async remove(ref: ObjectRef): Promise<void> {
    this.removedRefs.push(ref);
  }

  public async removeMany(refs: ObjectRef[]): Promise<void> {
    this.removedRefs.push(...refs);
  }

  public async exists(): Promise<boolean> {
    return false;
  }

  public async presignedGet(): Promise<string> {
    return 'unused';
  }
}

/** A `MediaRepository` whose `createWithDispatch` fails on the Nth call, run inside the real Prisma transaction. */
class FailingMediaRepository extends MediaRepository {
  private calls = 0;

  public constructor(private readonly failOnCallNumber: number) {
    super();
  }

  public override async createWithDispatch(
    ...args: Parameters<MediaRepository['createWithDispatch']>
  ): ReturnType<MediaRepository['createWithDispatch']> {
    this.calls += 1;
    if (this.calls === this.failOnCallNumber) {
      throw new Error('simulated database write failure');
    }
    return super.createWithDispatch(...args);
  }
}

describe('CreatePostService compensation (integration)', () => {
  let fixtures: string;
  let imageA: string;
  let imageB: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
    fixtures = await mkdtemp(join(tmpdir(), 'create-post-compensation-'));
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
          'color=c=#556677:s=6x4',
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
  });

  afterAll(async () => {
    await rm(fixtures, { recursive: true, force: true });
    await prisma.onModuleDestroy();
  });

  beforeEach(async () => {
    await prisma.idempotencyRequest.deleteMany();
    await prisma.processingDispatch.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  afterEach(async () => {
    await prisma.idempotencyRequest.deleteMany();
    await prisma.processingDispatch.deleteMany();
    await prisma.media.deleteMany();
    await prisma.post.deleteMany();
  });

  it('compensates by removing already-promoted originals when a later promotion fails', async () => {
    const storage = new FailingCopyStorage(2);
    const service = new CreatePostService(
      prisma,
      idempotency,
      mediaValidation,
      mediaRepository,
      objectKeys,
      storage,
    );

    await expect(
      service.execute({
        idempotencyKey: 'compensation-storage-failure-key',
        title: 'x',
        content: 'y',
        files: [
          multerFile(imageA, 'a.jpg', 'image/jpeg'),
          multerFile(imageB, 'b.jpg', 'image/jpeg'),
        ],
        requestId: 'req-storage-fail',
      }),
    ).rejects.toMatchObject({
      code: 'ORIGINAL_PROMOTION_FAILED',
      httpStatus: 503,
    });

    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.media.count()).toBe(0);
    // The first file's original was promoted before the second failed —
    // compensation must remove it.
    expect(storage.removedRefs.length).toBeGreaterThan(0);

    const idempotencyRow = await prisma.idempotencyRequest.findUniqueOrThrow({
      where: { key: 'compensation-storage-failure-key' },
    });
    expect(idempotencyRow.state).toBe('RETRYABLE_FAILURE');
  });

  it('compensates by removing promoted originals and rolling back the transaction when a domain write fails', async () => {
    const failingRepository = new FailingMediaRepository(2);
    const service = new CreatePostService(
      prisma,
      idempotency,
      mediaValidation,
      failingRepository,
      objectKeys,
      realStorage,
    );

    await expect(
      service.execute({
        idempotencyKey: 'compensation-db-failure-key',
        title: 'x',
        content: 'y',
        files: [
          multerFile(imageA, 'a.jpg', 'image/jpeg'),
          multerFile(imageB, 'b.jpg', 'image/jpeg'),
        ],
        requestId: 'req-db-fail',
      }),
    ).rejects.toThrow('simulated database write failure');

    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.media.count()).toBe(0);
    expect(await prisma.processingDispatch.count()).toBe(0);

    const idempotencyRow = await prisma.idempotencyRequest.findUniqueOrThrow({
      where: { key: 'compensation-db-failure-key' },
    });
    expect(idempotencyRow.state).toBe('RETRYABLE_FAILURE');
  });

  it('rethrows a validation-atomicity error unmodified (sanity check on the DomainError path)', async () => {
    const service = new CreatePostService(
      prisma,
      idempotency,
      mediaValidation,
      mediaRepository,
      objectKeys,
      realStorage,
    );

    const corrupt = join(fixtures, 'corrupt.jpg');
    await writeFile(corrupt, 'not-a-real-image');

    await expect(
      service.execute({
        idempotencyKey: 'validation-atomicity-key',
        title: 'x',
        content: 'y',
        files: [multerFile(corrupt, 'corrupt.jpg', 'image/jpeg')],
        requestId: 'req-validation-fail',
      }),
    ).rejects.toBeInstanceOf(DomainError);

    expect(await prisma.post.count()).toBe(0);
  });
});
