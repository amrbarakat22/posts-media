import { MediaType } from '@posts-media/domain';

import { queueConcurrencyFor, queueOptionsFor } from './queue-options';

const configuration = {
  redis: { host: 'redis', port: 6379 },
  worker: {
    imageConcurrency: 4,
    audioConcurrency: 2,
    videoConcurrency: 1,
    mediaJobAttempts: 3,
    mediaJobBackoffMs: 5000,
  },
} as const;

describe('BullMQ queue options', () => {
  it.each([
    [MediaType.IMAGE, 4],
    [MediaType.AUDIO, 2],
    [MediaType.VIDEO, 1],
  ])('uses the configured %s concurrency', (type, expected) => {
    expect(queueConcurrencyFor(type, configuration.worker)).toBe(expected);
  });

  it('configures bounded retention and exponential processing retry', () => {
    const options = queueOptionsFor(MediaType.IMAGE, configuration);

    expect(options.connection).toEqual({ host: 'redis', port: 6379 });
    expect(options.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 604800, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 },
    });
  });
});
