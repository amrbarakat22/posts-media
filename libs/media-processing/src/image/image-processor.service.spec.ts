import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as sharpModule from 'sharp';

interface TestSharpPipeline {
  png(): TestSharpPipeline;
  metadata(): Promise<{ format?: string; width?: number }>;
  toFile(path: string): Promise<unknown>;
}

const sharp = sharpModule as unknown as (input: unknown) => TestSharpPipeline;

import { ImageProcessorService } from './image-processor.service';

describe('ImageProcessorService', () => {
  const root = join(tmpdir(), `posts-media-image-${process.pid}`);
  const service = new ImageProcessorService();

  beforeAll(() => mkdir(root, { recursive: true }));
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('auto-orients, does not upscale, emits WebP and a thumbnail', async () => {
    const input = join(root, 'input.png');
    const optimized = join(root, 'optimized.webp');
    const thumbnail = join(root, 'thumbnail.webp');
    await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.5 },
      },
    })
      .png()
      .toFile(input);

    const result = await service.process(input, optimized, thumbnail, {
      maxWidth: 1920,
      maxHeight: 1920,
      thumbnailSize: 400,
      quality: 82,
    });

    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect((await sharp(optimized).metadata()).format).toBe('webp');
    expect((await sharp(thumbnail).metadata()).width).toBe(400);
  });

  it('rejects malformed images', async () => {
    const input = join(root, 'malformed.gif');
    await writeFile(input, 'not an image');
    await expect(
      service.process(input, join(root, 'a.webp'), join(root, 'b.webp'), {
        maxWidth: 1920,
        maxHeight: 1920,
        thumbnailSize: 400,
        quality: 82,
      }),
    ).rejects.toThrow('unsupported image format');
  });
});
