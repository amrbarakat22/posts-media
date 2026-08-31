import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFingerprintFiles } from './fingerprint-files';

const multerFile = (
  path: string,
  originalname: string,
  mimetype: string,
): Express.Multer.File =>
  ({ path, originalname, mimetype }) as Express.Multer.File;

describe('buildFingerprintFiles', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fingerprint-files-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('computes checksum, size, normalized filename, and canonical MIME for a valid file', async () => {
    const path = join(directory, 'a');
    await writeFile(path, 'hello world');

    const [result] = await buildFingerprintFiles([
      multerFile(path, 'photo.jpg', 'image/jpg'),
    ]);

    expect(result).toEqual({
      originalFilename: 'photo.jpg',
      declaredMimeType: 'image/jpeg',
      sizeBytes: '11',
      checksumSha256: createHash('sha256').update('hello world').digest('hex'),
    });
  });

  it('falls back to the raw filename/MIME for a file that would fail validation, rather than throwing', async () => {
    const path = join(directory, 'b');
    await writeFile(path, 'x');

    const [result] = await buildFingerprintFiles([
      multerFile(path, '', 'not-a-real-mime-type'),
    ]);

    expect(result).toMatchObject({
      originalFilename: '',
      declaredMimeType: 'not-a-real-mime-type',
      sizeBytes: '1',
    });
  });

  it('processes multiple files, preserving order', async () => {
    const pathA = join(directory, 'c');
    const pathB = join(directory, 'd');
    await writeFile(pathA, 'aaa');
    await writeFile(pathB, 'bbbb');

    const results = await buildFingerprintFiles([
      multerFile(pathA, 'a.jpg', 'image/jpeg'),
      multerFile(pathB, 'b.png', 'image/png'),
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.originalFilename).toBe('a.jpg');
    expect(results[1]?.originalFilename).toBe('b.png');
  });

  it('returns an empty array for zero files', async () => {
    expect(await buildFingerprintFiles([])).toEqual([]);
  });
});
