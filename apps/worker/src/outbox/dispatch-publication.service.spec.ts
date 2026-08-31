import { MediaType } from '@posts-media/domain';
import { mediaJobId } from '@posts-media/queues';

import { DispatchPublicationService } from './dispatch-publication.service';
import type { ClaimedDispatch } from './outbox-claim.repository';

const dispatch = (
  overrides: Partial<ClaimedDispatch> = {},
): ClaimedDispatch => ({
  id: 'd1',
  mediaId: 'm1',
  generation: 1,
  reason: 'INITIAL_UPLOAD',
  queueName: 'image-processing',
  jobName: 'process-image',
  jobId: mediaJobId('m1', 1),
  payloadVersion: 1,
  payload: {
    payloadVersion: 1,
    dispatchId: 'd1',
    mediaId: 'm1',
    postId: 'p1',
    mediaType: MediaType.IMAGE,
    generation: 1,
    processingProfile: 'balanced-v1',
    reason: 'INITIAL_UPLOAD',
  },
  publishAttempts: 0,
  leaseToken: '00000000-0000-0000-0000-000000000001',
  ...overrides,
});

describe('DispatchPublicationService', () => {
  it('publishes a stable payload with the deterministic job id and finalizes it', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const claims = {
      markPublished: jest.fn().mockResolvedValue(true),
      markDead: jest.fn(),
      markRetryWait: jest.fn(),
    };
    const service = new DispatchPublicationService(
      claims as never,
      { delayMs: jest.fn().mockReturnValue(1000) },
      { values: { outbox: { maxRetryDelaySeconds: 60 } } } as never,
      queue as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
    );

    await service.publish(dispatch());

    expect(queue.add).toHaveBeenCalledWith(
      'process-image',
      expect.objectContaining({ mediaId: 'm1', generation: 1 }),
      { jobId: mediaJobId('m1', 1) },
    );
    expect(claims.markPublished).toHaveBeenCalledWith(
      'd1',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(claims.markDead).not.toHaveBeenCalled();
  });

  it('marks unsupported mappings DEAD without publishing', async () => {
    const queue = { add: jest.fn() };
    const claims = {
      markPublished: jest.fn(),
      markDead: jest.fn().mockResolvedValue(true),
      markRetryWait: jest.fn(),
    };
    const service = new DispatchPublicationService(
      claims as never,
      { delayMs: jest.fn() },
      { values: { outbox: { maxRetryDelaySeconds: 60 } } } as never,
      queue as never,
      queue as never,
      queue as never,
    );

    await service.publish(dispatch({ jobName: 'not-a-real-job' }));

    expect(queue.add).not.toHaveBeenCalled();
    expect(claims.markDead).toHaveBeenCalledWith(
      'd1',
      expect.any(String),
      'OUTBOX_MAPPING_INVALID',
      expect.any(String),
    );
  });

  it('returns a transient publication failure to RETRY_WAIT', async () => {
    const queue = {
      add: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const claims = {
      markPublished: jest.fn(),
      markDead: jest.fn(),
      markRetryWait: jest.fn().mockResolvedValue(true),
    };
    const backoff = { delayMs: jest.fn().mockReturnValue(1234) };
    const service = new DispatchPublicationService(
      claims as never,
      backoff,
      { values: { outbox: { maxRetryDelaySeconds: 60 } } } as never,
      queue as never,
      queue as never,
      queue as never,
    );

    await service.publish(dispatch({ publishAttempts: 2 }));

    expect(backoff.delayMs).toHaveBeenCalledWith(3, 60);
    expect(claims.markRetryWait).toHaveBeenCalledWith(
      'd1',
      expect.any(String),
      expect.any(Date),
      'REDIS_PUBLISH_FAILED',
      'ECONNREFUSED',
    );
  });
});
