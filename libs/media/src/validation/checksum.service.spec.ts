import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ChecksumService } from './checksum.service';

describe('ChecksumService', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-checksum-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('calculates the lowercase streaming SHA-256 digest', async () => {
    const path = join(directory, 'content.bin');
    await writeFile(path, Buffer.from('abc'));

    await expect(new ChecksumService().calculate(path)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('maps read failures to a safe stable error', async () => {
    await expect(
      new ChecksumService().calculate(join(directory, 'missing.bin')),
    ).rejects.toMatchObject({
      code: 'CHECKSUM_CALCULATION_FAILED',
      details: undefined,
    });
  });
});
