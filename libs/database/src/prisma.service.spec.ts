import { PrismaService } from './prisma.service';

describe('PrismaService shutdown barriers', () => {
  it('keeps the database available until registered consumers finish draining', async () => {
    const prisma = new PrismaService(
      'postgresql://posts:posts@localhost:5432/posts_media_test',
      false,
    );
    const disconnect = jest
      .spyOn(prisma, '$disconnect')
      .mockResolvedValue(undefined);
    let finishDrain: (() => void) | undefined;
    const drain = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    prisma.registerShutdownBarrier(drain);

    const shutdown = prisma.onModuleDestroy();
    await Promise.resolve();
    expect(disconnect).not.toHaveBeenCalled();

    finishDrain!();
    await shutdown;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
