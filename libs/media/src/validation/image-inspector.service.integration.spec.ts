import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { ImageInspectorService } from './image-inspector.service';

describe('ImageInspectorService with real Sharp decoding', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-images-'));
    for (const [name, codec] of [
      ['valid.jpg', 'mjpeg'],
      ['valid.png', 'png'],
      ['valid.webp', 'libwebp'],
    ] as const) {
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=#336699:s=6x4',
        '-frames:v',
        '1',
        '-c:v',
        codec,
        join(directory, name),
      ]);
    }
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=4x4:r=2:d=1',
      '-loop',
      '0',
      '-c:v',
      'libwebp',
      join(directory, 'animated.webp'),
    ]);
    await writeFile(
      join(directory, 'corrupt.jpg'),
      Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]),
    );
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(100_000, 0);
    ihdr.writeUInt32BE(100_000, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    await writeFile(
      join(directory, 'truncated-pixel-bomb.png'),
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(Buffer.alloc(300_001))),
        pngChunk('IEND', Buffer.alloc(0)),
      ]),
    );
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['valid.jpg', 'jpeg', 'image/jpeg'],
    ['valid.png', 'png', 'image/png'],
    ['valid.webp', 'webp', 'image/webp'],
  ])(
    'decodes %s and returns sanitized metadata',
    async (name, format, mime) => {
      const result = await new ImageInspectorService(100).inspect(
        join(directory, name),
      );

      expect(result).toEqual({
        format,
        mimeType: mime,
        width: 6,
        height: 4,
        pages: 1,
      });
    },
  );

  it('rejects a real animated WebP', async () => {
    await expect(
      new ImageInspectorService(100).inspect(join(directory, 'animated.webp')),
    ).rejects.toMatchObject({ code: 'ANIMATED_IMAGE_NOT_SUPPORTED' });
  });

  it('rejects decoded dimensions above the configured pixel limit', async () => {
    await expect(
      new ImageInspectorService(23).inspect(join(directory, 'valid.png')),
    ).rejects.toMatchObject({
      code: 'IMAGE_PIXEL_LIMIT_EXCEEDED',
      details: { width: 6, height: 4, maxPixels: 23 },
    });
  });

  it('rejects a compressed pixel bomb from metadata before attempting its corrupt body decode', async () => {
    await expect(
      new ImageInspectorService(40_000_000).inspect(
        join(directory, 'truncated-pixel-bomb.png'),
      ),
    ).rejects.toMatchObject({
      code: 'IMAGE_PIXEL_LIMIT_EXCEEDED',
      details: { width: 100_000, height: 100_000, maxPixels: 40_000_000 },
    });
  });

  it('maps a valid-looking but truncated image to CORRUPTED_FILE safely', async () => {
    await expect(
      new ImageInspectorService(100).inspect(join(directory, 'corrupt.jpg')),
    ).rejects.toMatchObject({
      code: 'CORRUPTED_FILE',
      details: undefined,
    });
  });
});

const pngChunk = (type: string, data: Buffer): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
};

const crc32 = (data: Buffer): number => {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ ((checksum & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
};
