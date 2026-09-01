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
    const ping = jest.fn().mockResolvedValue(true);
    const service = new WorkerHeartbeatService(
      { workerInstance: { upsert } } as unknown as PrismaService,
      configuration,
      { ping } as unknown as MediaQueue,
      {
        exists: jest.fn().mockResolvedValue(false),
      } as unknown as ObjectStoragePort,
      {
        consumersActive: true,
        activeJobCount: 2,
      } as MediaQueueConsumersService,
    );

    await service.beat();
    await service.beat();

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(ping).toHaveBeenCalledTimes(2);

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

  it('bounds a stalled Redis probe and persists a degraded heartbeat', async () => {
    jest.useFakeTimers();
    try {
      const upsert = jest.fn().mockResolvedValue(undefined);
      const ping = jest.fn().mockReturnValue(new Promise(() => undefined));
      const service = new WorkerHeartbeatService(
        { workerInstance: { upsert } } as unknown as PrismaService,
        configuration,
        { ping } as unknown as MediaQueue,
        {
          exists: jest.fn().mockResolvedValue(false),
        } as unknown as ObjectStoragePort,
        {
          consumersActive: true,
          activeJobCount: 0,
        } as MediaQueueConsumersService,
      );

      const heartbeat = service.beat();
      const secondHeartbeat = service.beat();
      await jest.advanceTimersByTimeAsync(3_000);
      await Promise.all([heartbeat, secondHeartbeat]);

      expect(ping).toHaveBeenCalledTimes(1);

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: 'DEGRADED',
            redisConnected: false,
          }),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for an in-flight heartbeat before persisting STOPPED', async () => {
    jest.useFakeTimers();
    try {
      let releasePing: () => void = () => undefined;
      const pingGate = new Promise<void>((resolve) => {
        releasePing = resolve;
      });
      const upsert = jest.fn().mockResolvedValue(undefined);
      const updateMany = jest.fn().mockResolvedValue(undefined);
      const lifecycleConfiguration = {
        ...configuration,
        values: {
          ...configuration.values,
          app: { nodeEnvironment: 'development' },
        },
      } as EnvironmentConfigurationService;
      const service = new WorkerHeartbeatService(
        { workerInstance: { upsert, updateMany } } as unknown as PrismaService,
        lifecycleConfiguration,
        { ping: jest.fn().mockReturnValue(pingGate) } as unknown as MediaQueue,
        {
          exists: jest.fn().mockResolvedValue(false),
        } as unknown as ObjectStoragePort,
        {
          consumersActive: true,
          activeJobCount: 0,
        } as MediaQueueConsumersService,
      );

      service.onModuleInit();
      await Promise.resolve();
      const destroy = service.onModuleDestroy();
      expect(updateMany).not.toHaveBeenCalled();
      releasePing();
      await destroy;

      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'STOPPED' }),
        }),
      );
      expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(
        updateMany.mock.invocationCallOrder[0]!,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
