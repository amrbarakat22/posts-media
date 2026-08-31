import type { EnvironmentConfigurationService } from '@posts-media/configuration';
import type { PrismaService } from '@posts-media/database';
import type { MediaQueue } from '@posts-media/queues';
import type { ObjectStoragePort } from '@posts-media/storage';

import type { MediaQueueConsumersService } from '../consumers/media-queue-consumers.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

describe('WorkerHeartbeatService', () => {
  const configuration = {
    values: {
      app: { nodeEnvironment: 'test' },
      storage: { originalsBucket: 'post-originals' },
      worker: { heartbeatIntervalSeconds: 10 },
    },
  } as EnvironmentConfigurationService;

  it('persists a ready heartbeat when dependencies and consumers are available', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const service = new WorkerHeartbeatService(
      { workerInstance: { upsert } } as unknown as PrismaService,
      configuration,
      { ping: jest.fn().mockResolvedValue(true) } as unknown as MediaQueue,
      {
        exists: jest.fn().mockResolvedValue(false),
      } as unknown as ObjectStoragePort,
      {
        consumersActive: true,
        activeJobCount: 2,
      } as MediaQueueConsumersService,
    );

    await service.beat();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'READY',
          redisConnected: true,
          storageConnected: true,
          consumersActive: true,
          activeJobCount: 2,
        }),
      }),
    );
  });

  it('persists a degraded heartbeat when Redis is unavailable', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const service = new WorkerHeartbeatService(
      { workerInstance: { upsert } } as unknown as PrismaService,
      configuration,
      {
        ping: jest.fn().mockRejectedValue(new Error('offline')),
      } as unknown as MediaQueue,
      {
        exists: jest.fn().mockResolvedValue(false),
      } as unknown as ObjectStoragePort,
      {
        consumersActive: true,
        activeJobCount: 0,
      } as MediaQueueConsumersService,
    );

    await service.beat();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: 'DEGRADED',
          redisConnected: false,
          storageConnected: true,
        }),
      }),
    );
  });
});
