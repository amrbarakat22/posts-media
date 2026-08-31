import { GracefulShutdownService } from './graceful-shutdown.service';

describe('GracefulShutdownService', () => {
  it('terminates tracked children and escalates after the grace period', async () => {
    const child = { kill: jest.fn().mockReturnValue(true), once: jest.fn() };
    const service = new GracefulShutdownService();
    service.track(child);

    await service.shutdown(1);

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });
});
