import { ObjectKeyService } from './object-key.service';

const buckets = {
  originals: 'post-originals',
  processed: 'post-processed',
  temporary: 'post-temporary',
};

describe('ObjectKeyService', () => {
  const service = new ObjectKeyService(buckets);

  describe('originalKey', () => {
    it('is deterministic from postId, mediaId, and canonical extension', () => {
      const first = service.originalKey('post-1', 'media-1', 'png');
      const second = service.originalKey('post-1', 'media-1', 'png');

      expect(first).toEqual(second);
      expect(first).toEqual({
        bucket: 'post-originals',
        objectKey: 'posts/post-1/media-1/original.png',
      });
    });

    it('has no parameter for the user-supplied original filename', () => {
      // The method signature itself excludes the untrusted filename —
      // only controlled IDs and the canonical (detected) extension can
      // influence the path.
      expect(ObjectKeyService.prototype.originalKey.length).toBe(3);
    });

    it('changes only when a controlled ID or extension changes', () => {
      const base = service.originalKey('post-1', 'media-1', 'png');

      expect(service.originalKey('post-2', 'media-1', 'png')).not.toEqual(base);
      expect(service.originalKey('post-1', 'media-2', 'png')).not.toEqual(base);
      expect(service.originalKey('post-1', 'media-1', 'webp')).not.toEqual(
        base,
      );
    });
  });

  describe('processedKey', () => {
    it('is deterministic from postId, mediaId, profile, and a canonical filename', () => {
      const key = service.processedKey(
        'post-1',
        'media-1',
        'balanced-v1',
        'optimized.webp',
      );

      expect(key).toEqual({
        bucket: 'post-processed',
        objectKey: 'posts/post-1/media-1/balanced-v1/optimized.webp',
      });
    });

    it('has no parameter for the user-supplied original filename', () => {
      expect(ObjectKeyService.prototype.processedKey.length).toBe(4);
    });
  });

  describe('processedAttemptKey', () => {
    it('isolates final artifacts by generation and attempt ownership', () => {
      const first = service.processedAttemptKey(
        'post-1',
        'media-1',
        'balanced-v1',
        1,
        'attempt-1',
        'optimized.webp',
      );
      const newerOwner = service.processedAttemptKey(
        'post-1',
        'media-1',
        'balanced-v1',
        1,
        'attempt-2',
        'optimized.webp',
      );

      expect(first).toEqual({
        bucket: 'post-processed',
        objectKey:
          'posts/post-1/media-1/balanced-v1/generations/1/attempts/attempt-1/optimized.webp',
      });
      expect(newerOwner).not.toEqual(first);
    });
  });

  describe('uploadStagingKey', () => {
    it('is deterministic from a controlled requestId and fileId only', () => {
      const key = service.uploadStagingKey('req-1', 'file-1');

      expect(key).toEqual({
        bucket: 'post-temporary',
        objectKey: 'uploads/req-1/file-1',
      });
    });

    it('has no parameter for the user-supplied original filename', () => {
      expect(ObjectKeyService.prototype.uploadStagingKey.length).toBe(2);
    });
  });

  describe('processingTempKey', () => {
    it('is deterministic from mediaId, generation, attemptId, and a canonical variant filename', () => {
      const key = service.processingTempKey(
        'media-1',
        2,
        'attempt-1',
        'video-720p.mp4',
      );

      expect(key).toEqual({
        bucket: 'post-temporary',
        objectKey: 'processing/media-1/2/attempt-1/video-720p.mp4',
      });
    });

    it('separates stale and current generations for the same media', () => {
      const generationOne = service.processingTempKey(
        'media-1',
        1,
        'attempt-1',
        'video-720p.mp4',
      );
      const generationTwo = service.processingTempKey(
        'media-1',
        2,
        'attempt-1',
        'video-720p.mp4',
      );

      expect(generationOne).not.toEqual(generationTwo);
    });
  });
});
