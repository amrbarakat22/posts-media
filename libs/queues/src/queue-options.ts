import type { QueueOptions } from 'bullmq';

import { MediaType } from '@posts-media/domain';

interface QueueRuntimeConfiguration {
  readonly redis: { readonly host: string; readonly port: number };
  readonly worker: {
    readonly imageConcurrency: number;
    readonly audioConcurrency: number;
    readonly videoConcurrency: number;
    readonly mediaJobAttempts: number;
    readonly mediaJobBackoffMs: number;
  };
}

export const queueOptionsFor = (
  mediaType: MediaType,
  configuration: QueueRuntimeConfiguration,
): QueueOptions => ({
  connection: {
    host: configuration.redis.host,
    port: configuration.redis.port,
  },
  defaultJobOptions: {
    attempts: configuration.worker.mediaJobAttempts,
    backoff: {
      type: 'exponential',
      delay: configuration.worker.mediaJobBackoffMs,
    },
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
  },
  prefix: `posts-media:${mediaType.toLowerCase()}`,
});

export const queueConcurrencyFor = (
  mediaType: MediaType,
  worker: QueueRuntimeConfiguration['worker'],
): number => {
  switch (mediaType) {
    case MediaType.IMAGE:
      return worker.imageConcurrency;
    case MediaType.AUDIO:
      return worker.audioConcurrency;
    case MediaType.VIDEO:
      return worker.videoConcurrency;
  }
};
