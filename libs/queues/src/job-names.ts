import { MediaType } from '@posts-media/domain';

/** Job name per queue (Part I §12.1). */
export const JOB_NAMES = {
  [MediaType.IMAGE]: 'process-image',
  [MediaType.AUDIO]: 'process-audio',
  [MediaType.VIDEO]: 'process-video',
} as const satisfies Record<MediaType, string>;

export const jobNameFor = (mediaType: MediaType): string =>
  JOB_NAMES[mediaType];

/**
 * Deterministic logical BullMQ job id (Part I §2.13). Automatic BullMQ
 * retries reuse the same generation; a manual retry after final failure
 * increments it, producing a new job id.
 */
export const mediaJobId = (mediaId: string, generation: number): string =>
  `media-${mediaId}-generation-${generation}`;
