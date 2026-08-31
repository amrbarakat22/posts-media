import type { Media, Post } from '@prisma/client';

import { presentPost } from './post.presenter';

const basePost = {
  id: 'post-1',
  title: 'Hello world',
  content: 'Body text',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  deletedAt: null,
} as unknown as Post;

const media = (processingStatus: string, sortOrder: number): Media =>
  ({
    id: `media-${sortOrder}`,
    postId: 'post-1',
    sortOrder,
    mediaType: 'IMAGE',
    processingStatus,
    progress: processingStatus === 'COMPLETED' ? 100 : 0,
  }) as unknown as Media;

describe('presentPost', () => {
  it('reports NO_MEDIA aggregate status and zero media count with no media', () => {
    const dto = presentPost({ ...basePost, media: [] });

    expect(dto.aggregateStatus).toBe('NO_MEDIA');
    expect(dto.mediaCount).toBe(0);
    expect(dto.media).toEqual([]);
    expect(dto.links).toEqual({ self: '/api/posts/post-1' });
  });

  it('computes the aggregate status from included media statuses', () => {
    const dto = presentPost({
      ...basePost,
      media: [media('COMPLETED', 0), media('FAILED', 1)],
    });

    expect(dto.aggregateStatus).toBe('PARTIALLY_COMPLETED');
    expect(dto.mediaCount).toBe(2);
  });

  it('serializes timestamps as ISO strings and passes through soft-delete state', () => {
    const dto = presentPost({
      ...basePost,
      deletedAt: new Date('2026-01-03T00:00:00.000Z'),
      media: [],
    });

    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(dto.deletedAt).toBe('2026-01-03T00:00:00.000Z');
  });
});
