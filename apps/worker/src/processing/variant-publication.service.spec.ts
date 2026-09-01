import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ObjectKeyService } from '@posts-media/storage';
import type { Media } from '@prisma/client';

import { VariantPublicationService } from './variant-publication.service';

const media = {
  id: '00000000-0000-0000-0000-000000000001',
  postId: '00000000-0000-0000-0000-000000000002',
  processingProfile: 'balanced-v1',
} as unknown as Media;

const keys = new ObjectKeyService({
  originals: 'originals',
  processed: 'processed',
  temporary: 'temporary',
});

describe('VariantPublicationService failure compensation', () => {
  let root: string;
  let artifactPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'variant-publication-'));
    artifactPath = join(root, 'optimized.webp');
    await writeFile(artifactPath, Buffer.from('processed artifact'));
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  const artifact = () => ({
    path: artifactPath,
    filename: 'optimized.webp',
    variantType: 'OPTIMIZED_IMAGE' as const,
    mimeType: 'image/webp',
    format: 'webp',
  });

  const transaction = (guardCount = 1) => ({
    media: { updateMany: jest.fn().mockResolvedValue({ count: guardCount }) },
    mediaVariant: { upsert: jest.fn().mockResolvedValue(undefined) },
    processingAttempt: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  });

  const storage = () => ({
    putFile: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ sizeBytes: 1n }),
    copy: jest.fn().mockResolvedValue(undefined),
    removeMany: jest.fn().mockResolvedValue(undefined),
  });

  it('does not enter the database transaction when temporary upload fails', async () => {
    const objectStorage = storage();
    objectStorage.putFile.mockRejectedValueOnce(new Error('MINIO_UNAVAILABLE'));
    const prisma = { withTransaction: jest.fn() };
    const service = new VariantPublicationService(
      prisma as never,
      objectStorage as never,
      keys,
    );

    await expect(
      service.publish(media, 1, 'attempt-1', 'lease-1', [artifact()]),
    ).rejects.toThrow('MINIO_UNAVAILABLE');
    expect(prisma.withTransaction).not.toHaveBeenCalled();
    expect(objectStorage.removeMany).toHaveBeenCalled();
  });

  it('compensates the final object when copy succeeds but verification fails', async () => {
    const objectStorage = storage();
    objectStorage.stat
      .mockResolvedValueOnce({ sizeBytes: 1n })
      .mockRejectedValueOnce(new Error('MINIO_FINAL_STAT_FAILED'));
    const prisma = { withTransaction: jest.fn() };
    const service = new VariantPublicationService(
      prisma as never,
      objectStorage as never,
      keys,
    );

    await expect(
      service.publish(media, 1, 'attempt-1', 'lease-1', [artifact()]),
    ).rejects.toThrow('MINIO_FINAL_STAT_FAILED');
    const final = keys.processedAttemptKey(
      media.postId,
      media.id,
      media.processingProfile,
      1,
      'attempt-1',
      'optimized.webp',
    );
    expect(objectStorage.removeMany).toHaveBeenCalledWith(
      expect.arrayContaining([final]),
    );
    expect(prisma.withTransaction).not.toHaveBeenCalled();
  });

  it('compensates a destination that may have been partially created before copy rejects', async () => {
    const objectStorage = storage();
    objectStorage.copy.mockRejectedValueOnce(
      new Error('MINIO_PARTIAL_COPY_FAILED'),
    );
    const prisma = { withTransaction: jest.fn() };
    const service = new VariantPublicationService(
      prisma as never,
      objectStorage as never,
      keys,
    );

    await expect(
      service.publish(media, 1, 'attempt-1', 'lease-1', [artifact()]),
    ).rejects.toThrow('MINIO_PARTIAL_COPY_FAILED');
    expect(objectStorage.removeMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        keys.processedAttemptKey(
          media.postId,
          media.id,
          media.processingProfile,
          1,
          'attempt-1',
          'optimized.webp',
        ),
      ]),
    );
    expect(prisma.withTransaction).not.toHaveBeenCalled();
  });

  it('removes published objects when PostgreSQL finalization fails', async () => {
    const objectStorage = storage();
    const tx = transaction();
    tx.media.updateMany.mockRejectedValueOnce(
      new Error('POSTGRES_FINALIZATION_FAILED'),
    );
    const prisma = {
      withTransaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new VariantPublicationService(
      prisma as never,
      objectStorage as never,
      keys,
    );

    await expect(
      service.publish(media, 1, 'attempt-1', 'lease-1', [artifact()]),
    ).rejects.toThrow('POSTGRES_FINALIZATION_FAILED');
    const final = keys.processedAttemptKey(
      media.postId,
      media.id,
      media.processingProfile,
      1,
      'attempt-1',
      'optimized.webp',
    );
    expect(objectStorage.removeMany).toHaveBeenCalledWith(
      expect.arrayContaining([final]),
    );
    expect(tx.mediaVariant.upsert).not.toHaveBeenCalled();
  });

  it('prevents a stale lease owner from finalizing variants or COMPLETED', async () => {
    const objectStorage = storage();
    const tx = transaction(0);
    const prisma = {
      withTransaction: jest.fn(async (callback) => callback(tx)),
    };
    const service = new VariantPublicationService(
      prisma as never,
      objectStorage as never,
      keys,
    );

    await expect(
      service.publish(media, 1, 'attempt-1', 'stale-lease', [artifact()]),
    ).rejects.toThrow('PROCESSING_LEASE_LOST');
    expect(tx.mediaVariant.upsert).not.toHaveBeenCalled();
    expect(tx.processingAttempt.updateMany).not.toHaveBeenCalled();
    expect(objectStorage.removeMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        keys.processedAttemptKey(
          media.postId,
          media.id,
          media.processingProfile,
          1,
          'attempt-1',
          'optimized.webp',
        ),
      ]),
    );
  });
});
