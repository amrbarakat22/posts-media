import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('maps a valid-looking but truncated image to CORRUPTED_FILE safely', async () => {
    await expect(
      new ImageInspectorService(100).inspect(join(directory, 'corrupt.jpg')),
    ).rejects.toMatchObject({
      code: 'CORRUPTED_FILE',
      details: undefined,
    });
  });
});
