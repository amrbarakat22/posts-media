import { MediaType } from '@posts-media/domain';

/** The three BullMQ queues (Part I §2.13/§12.1). Full BullMQ wiring lands in Task 12; this mapping is a pure, framework-independent fact both the dispatch-creation and dispatch-consumption sides depend on. */
export const QUEUE_NAMES = {
  [MediaType.IMAGE]: 'image-processing',
  [MediaType.AUDIO]: 'audio-processing',
  [MediaType.VIDEO]: 'video-processing',
} as const satisfies Record<MediaType, string>;

export const queueNameFor = (mediaType: MediaType): string =>
  QUEUE_NAMES[mediaType];
