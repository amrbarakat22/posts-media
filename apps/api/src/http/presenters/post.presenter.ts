import type { Media, Post } from '@prisma/client';

import {
  calculatePostAggregateStatus,
  ProcessingStatus,
} from '@posts-media/domain';

export interface MediaSummaryDto {
  id: string;
  sortOrder: number;
  mediaType: string;
  processingStatus: string;
  progress: number;
}

export interface PostLinksDto {
  self: string;
}

export interface PostResponseDto {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  aggregateStatus: string;
  mediaCount: number;
  media: MediaSummaryDto[];
  links: PostLinksDto;
}

export type PostWithMedia = Post & { media: Media[] };

const presentMediaSummary = (media: Media): MediaSummaryDto => ({
  id: media.id,
  sortOrder: media.sortOrder,
  mediaType: media.mediaType,
  processingStatus: media.processingStatus,
  progress: media.progress,
});

/**
 * Converts a raw Prisma `Post` record (with its media) into the stable API
 * response DTO. The aggregate status is always computed from the included
 * media's processing statuses — it is never read from a stored column.
 */
export function presentPost(post: PostWithMedia): PostResponseDto {
  const statuses = post.media.map(
    (media) => media.processingStatus as ProcessingStatus,
  );

  return {
    id: post.id,
    title: post.title,
    content: post.content,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    deletedAt: post.deletedAt !== null ? post.deletedAt.toISOString() : null,
    aggregateStatus: calculatePostAggregateStatus(statuses),
    mediaCount: post.media.length,
    media: post.media.map(presentMediaSummary),
    links: { self: `/api/posts/${post.id}` },
  };
}
