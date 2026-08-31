import type { Media, MediaVariant } from '@prisma/client';

import { presentMedia } from './media.presenter';

const baseMedia = {
  id: 'media-1',
  postId: 'post-1',
  sortOrder: 0,
  mediaType: 'IMAGE',
  originalFilename: 'photo.png',
  originalExtension: 'png',
  declaredMimeType: 'image/png',
  detectedMimeType: 'image/png',
  detectedFormat: 'png',
  originalBucket: 'post-originals',
  originalObjectKey: 'secret/internal/path.png',
  originalSize: 12345678901234n,
  checksumSha256: 'a'.repeat(64),
  processingProfile: 'balanced-v1',
  processingGeneration: 1,
  processingStatus: 'COMPLETED',
  progress: 100,
  currentStep: 'COMPLETED',
  processingStartedAt: null,
  processingCompletedAt: null,
  processingLeaseToken: null,
  processingLeaseExpiresAt: null,
  activeJobId: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  metadata: { width: 100, height: 100 },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as Media;

const baseVariant = {
  id: 'variant-1',
  mediaId: 'media-1',
  processingProfile: 'balanced-v1',
  variantType: 'OPTIMIZED_IMAGE',
  bucket: 'post-processed',
  objectKey: 'secret/internal/variant.webp',
  mimeType: 'image/webp',
  format: 'webp',
  size: 4096n,
  checksumSha256: 'b'.repeat(64),
  width: 1920,
  height: 1080,
  bitrateKbps: null,
  resolutionLabel: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} as unknown as MediaVariant;

describe('presentMedia', () => {
  it('serializes BigInt fields as decimal strings', () => {
    const dto = presentMedia({ ...baseMedia, variants: [baseVariant] });

    expect(dto.originalSize).toBe('12345678901234');
    expect(typeof dto.originalSize).toBe('string');
  });

  it('never leaks bucket names, object keys, or other storage internals', () => {
    const dto = presentMedia({ ...baseMedia, variants: [baseVariant] });
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('post-originals');
    expect(serialized).not.toContain('post-processed');
    expect(serialized).not.toContain('secret/internal');
  });

  it('includes links but omits retry unless the media has failed', () => {
    const completed = presentMedia({ ...baseMedia, variants: [] });
    expect(completed.links).toEqual({
      self: '/api/media/media-1',
      status: '/api/media/media-1/status',
      access: '/api/media/media-1/access',
    });

    const failed = presentMedia({
      ...baseMedia,
      processingStatus: 'FAILED',
      lastErrorCode: 'PROCESSING_TIMEOUT',
      lastErrorMessage: 'Processing timed out.',
      variants: [],
    });
    expect(failed.links).toEqual({
      self: '/api/media/media-1',
      status: '/api/media/media-1/status',
      access: '/api/media/media-1/access',
      retry: '/api/media/media-1/retry',
    });
    expect(failed.lastError).toEqual({
      code: 'PROCESSING_TIMEOUT',
      message: 'Processing timed out.',
    });
  });

  it('reports a null lastError when the media has not failed', () => {
    const dto = presentMedia({ ...baseMedia, variants: [] });
    expect(dto.lastError).toBeNull();
  });
});
