import { MediaQueueConsumersService } from './media-queue-consumers.service';

describe('MediaQueueConsumersService shutdown lifecycle', () => {
  it('stops intake, interrupts children, then waits for active handlers before closing', async () => {
    const graceful = { shutdown: jest.fn().mockResolvedValue(undefined) };
    let shutdownBarrier: Promise<void> | undefined;
    const prisma = {
      registerShutdownBarrier: jest.fn((barrier: Promise<void>) => {
        shutdownBarrier = barrier;
      }),
    };
    const service = new MediaQueueConsumersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      graceful as never,
      prisma as never,
    );
    const workers = Reflect.get(service, 'workers') as Array<{
      closing: boolean;
      pause: jest.Mock<Promise<void>, [boolean]>;
      close: jest.Mock<Promise<void>, [boolean]>;
    }>;
    const fakeWorkers = Array.from({ length: 3 }, () => ({
      closing: false,
      pause: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    }));
    workers.push(...fakeWorkers);
    Reflect.set(service, 'activeJobs', 1);
    setTimeout(() => Reflect.set(service, 'activeJobs', 0), 20);

    await service.onModuleDestroy();
    await expect(shutdownBarrier).resolves.toBeUndefined();
    expect(prisma.registerShutdownBarrier).toHaveBeenCalledTimes(1);

    for (const worker of fakeWorkers) {
      expect(worker.pause).toHaveBeenCalledWith(true);
      expect(worker.close).toHaveBeenCalledWith(false);
      expect(worker.pause.mock.invocationCallOrder[0]).toBeLessThan(
        graceful.shutdown.mock.invocationCallOrder[0]!,
      );
      expect(graceful.shutdown.mock.invocationCallOrder[0]).toBeLessThan(
        worker.close.mock.invocationCallOrder[0]!,
      );
    }
  });

  it('force-closes workers after the bounded drain deadline', async () => {
    jest.useFakeTimers();
    const graceful = { shutdown: jest.fn().mockResolvedValue(undefined) };
    let shutdownBarrier: Promise<void> | undefined;
    const service = new MediaQueueConsumersService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      graceful as never,
      {
        registerShutdownBarrier: (barrier: Promise<void>) => {
          shutdownBarrier = barrier;
        },
      } as never,
    );
    const workers = Reflect.get(service, 'workers') as Array<{
      closing: boolean;
      pause: jest.Mock<Promise<void>, [boolean]>;
      close: jest.Mock<Promise<void>, [boolean]>;
    }>;
    const worker = {
      closing: false,
      pause: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    workers.push(worker);
    Reflect.set(service, 'activeJobs', 1);

    const shutdown = service.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5100);
    await shutdown;

    expect(worker.close).toHaveBeenCalledWith(true);
    await expect(shutdownBarrier).resolves.toBeUndefined();
    jest.useRealTimers();
  });
});
