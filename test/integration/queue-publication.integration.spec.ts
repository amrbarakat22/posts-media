import { Queue } from 'bullmq';
import { MediaType } from '@posts-media/domain';
import { jobNameFor, mediaJobId, queueOptionsFor } from '@posts-media/queues';

describe('BullMQ publication integration', () => {
  const queue = new Queue(
    'image-processing',
    queueOptionsFor(MediaType.IMAGE, {
      redis: { host: process.env.REDIS_HOST ?? 'redis', port: 6379 },
      worker: {
        imageConcurrency: 4,
        audioConcurrency: 2,
        videoConcurrency: 1,
        mediaJobAttempts: 3,
        mediaJobBackoffMs: 5000,
      },
    }),
  );

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => queue.close());

  it('publishes and deduplicates a deterministic job id', async () => {
    const payload = {
      payloadVersion: 1 as const,
      dispatchId: '00000000-0000-0000-0000-000000000001',
      mediaId: '00000000-0000-0000-0000-000000000002',
      postId: '00000000-0000-0000-0000-000000000003',
      mediaType: MediaType.IMAGE,
      generation: 1,
      processingProfile: 'balanced-v1' as const,
      reason: 'INITIAL_UPLOAD' as const,
    };
    const jobId = mediaJobId(payload.mediaId, payload.generation);

    const first = await queue.add(jobNameFor(MediaType.IMAGE), payload, {
      jobId,
    });
    const second = await queue.add(jobNameFor(MediaType.IMAGE), payload, {
      jobId,
    });

    expect(first.id).toBe(jobId);
    expect(second.id).toBe(jobId);
    expect(await queue.getJobCounts('waiting', 'active')).toEqual({
      waiting: 1,
      active: 0,
      paused: 0,
    });
  });
});
