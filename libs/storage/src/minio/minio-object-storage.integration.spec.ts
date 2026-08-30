import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpGet } from 'node:http';

import { MinioObjectStorageAdapter } from './minio-object-storage.adapter';

const endpoint = process.env.MINIO_ENDPOINT;
const port = process.env.MINIO_PORT;
const accessKey = process.env.MINIO_ACCESS_KEY;
const secretKey = process.env.MINIO_SECRET_KEY;

if (
  endpoint === undefined ||
  port === undefined ||
  accessKey === undefined ||
  secretKey === undefined
) {
  throw new Error(
    'MINIO_ENDPOINT, MINIO_PORT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY must be set for storage integration tests',
  );
}

const bucket = process.env.MINIO_TEMP_BUCKET ?? 'post-temporary';

const adapter = new MinioObjectStorageAdapter({
  endpoint,
  port: Number(port),
  useSsl: false,
  accessKey,
  secretKey,
});

const fetchBody = (url: string): Promise<{ status: number; body: Buffer }> =>
  new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks),
        }),
      );
      response.on('error', reject);
    }).on('error', reject);
  });

describe('MinioObjectStorageAdapter', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'storage-integration-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const localFile = async (contents: string): Promise<string> => {
    const filePath = join(workDir, `${randomUUID()}.txt`);
    await writeFile(filePath, contents, 'utf8');
    return filePath;
  };

  it('puts a file and stats it back with a matching size', async () => {
    const objectKey = `integration/${randomUUID()}.txt`;
    const contents = 'put-and-stat contents';
    const filePath = await localFile(contents);

    const stored = await adapter.putFile({ bucket, objectKey }, filePath);
    expect(stored.sizeBytes).toBe(BigInt(Buffer.byteLength(contents)));

    const stat = await adapter.stat({ bucket, objectKey });
    expect(stat.sizeBytes).toBe(BigInt(Buffer.byteLength(contents)));
    expect(stat.bucket).toBe(bucket);
    expect(stat.objectKey).toBe(objectKey);
  });

  it('copies an object to a new key and stats the destination independently', async () => {
    const sourceKey = `integration/${randomUUID()}.txt`;
    const destinationKey = `integration/${randomUUID()}.txt`;
    const contents = 'copy-source contents';
    const filePath = await localFile(contents);

    await adapter.putFile({ bucket, objectKey: sourceKey }, filePath);
    const copied = await adapter.copy(
      { bucket, objectKey: sourceKey },
      { bucket, objectKey: destinationKey },
    );

    expect(copied.sizeBytes).toBe(BigInt(Buffer.byteLength(contents)));
    await expect(
      adapter.exists({ bucket, objectKey: destinationKey }),
    ).resolves.toBe(true);
  });

  it('downloads an object to a local file with byte-identical contents', async () => {
    const objectKey = `integration/${randomUUID()}.txt`;
    const contents = 'download-roundtrip contents';
    const filePath = await localFile(contents);
    await adapter.putFile({ bucket, objectKey }, filePath);

    const destinationPath = join(workDir, `${randomUUID()}-downloaded.txt`);
    await adapter.downloadToFile({ bucket, objectKey }, destinationPath);

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(contents);
  });

  it('returns a presigned URL that serves the exact object bytes', async () => {
    const objectKey = `integration/${randomUUID()}.txt`;
    const contents = 'presigned contents';
    const filePath = await localFile(contents);
    await adapter.putFile({ bucket, objectKey }, filePath);

    const url = await adapter.presignedGet({ bucket, objectKey }, 60);
    expect(url).toMatch(/^http/);

    const response = await fetchBody(url);
    expect(response.status).toBe(200);
    expect(response.body.toString('utf8')).toBe(contents);
  });

  it('removes an object so it no longer exists', async () => {
    const objectKey = `integration/${randomUUID()}.txt`;
    const filePath = await localFile('to-be-removed');
    await adapter.putFile({ bucket, objectKey }, filePath);

    await adapter.remove({ bucket, objectKey });

    await expect(adapter.exists({ bucket, objectKey })).resolves.toBe(false);
  });

  it('removes many objects in one call', async () => {
    const refs = await Promise.all(
      [0, 1, 2].map(async () => {
        const objectKey = `integration/${randomUUID()}.txt`;
        const filePath = await localFile('batch-removed');
        await adapter.putFile({ bucket, objectKey }, filePath);
        return { bucket, objectKey };
      }),
    );

    await adapter.removeMany(refs);

    for (const ref of refs) {
      await expect(adapter.exists(ref)).resolves.toBe(false);
    }
  });

  it('reports exists=false for an object that was never created', async () => {
    await expect(
      adapter.exists({ bucket, objectKey: `integration/${randomUUID()}.txt` }),
    ).resolves.toBe(false);
  });

  it('rejects stat and downloadToFile for a missing object instead of silently succeeding', async () => {
    const missingKey = `integration/${randomUUID()}.txt`;

    await expect(
      adapter.stat({ bucket, objectKey: missingKey }),
    ).rejects.toThrow();
    await expect(
      adapter.downloadToFile(
        { bucket, objectKey: missingKey },
        join(workDir, 'never-written.txt'),
      ),
    ).rejects.toThrow();
  });
});
