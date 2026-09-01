import { FfmpegService, type ChildProcessTracker } from './ffmpeg.service';

describe('FfmpegService child lifecycle', () => {
  it('tracks and terminates a real child when processing times out', async () => {
    const tracker: ChildProcessTracker = {
      track: jest.fn((child) => child),
      untrack: jest.fn(),
    };
    const service = new FfmpegService(tracker);

    await expect(
      service.run(['-e', 'setInterval(() => undefined, 1000)'], {
        binary: process.execPath,
        timeoutMs: 25,
      }),
    ).rejects.toThrow('PROCESSING_TIMEOUT');

    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.untrack).toHaveBeenCalledTimes(1);
  });
});
