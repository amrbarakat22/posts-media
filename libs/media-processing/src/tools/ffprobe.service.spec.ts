import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import type { ChildProcessTracker } from './ffmpeg.service';
import { FfprobeService } from './ffprobe.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));

interface ControlledChild extends ChildProcess {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly kill: jest.Mock<boolean, [NodeJS.Signals?]>;
}

const controlledChild = (): ControlledChild => {
  const child = new EventEmitter() as ControlledChild;
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(() => {
      queueMicrotask(() => child.emit('close', null));
      return true;
    }),
  });
  return child;
};

describe('FfprobeService subprocess safety', () => {
  let child: ControlledChild;
  let tracker: ChildProcessTracker;

  beforeEach(() => {
    child = controlledChild();
    jest.mocked(spawn).mockReturnValue(child);
    tracker = {
      track: jest.fn((trackedChild) => trackedChild),
      untrack: jest.fn(),
    };
  });

  it('rejects oversized output after terminating and untracking the child', async () => {
    const result = new FfprobeService(tracker).probe('/ignored', {
      maxOutputBytes: 1,
    });
    child.stderr.write('oversized');

    await expect(result).rejects.toThrow('FFPROBE_OUTPUT_LIMIT');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(tracker.track).toHaveBeenCalledWith(child);
    expect(tracker.untrack).toHaveBeenCalledWith(child);
  });

  it('rejects a timeout after terminating and untracking the child', async () => {
    jest.useFakeTimers();
    try {
      const result = new FfprobeService(tracker).probe('/ignored', {
        timeoutMs: 25,
      });
      await jest.advanceTimersByTimeAsync(25);

      await expect(result).rejects.toThrow('MEDIA_VALIDATION_TIMEOUT');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(tracker.track).toHaveBeenCalledWith(child);
      expect(tracker.untrack).toHaveBeenCalledWith(child);
    } finally {
      jest.useRealTimers();
    }
  });

  it('parses controlled output and untracks a successful child', async () => {
    const result = new FfprobeService(tracker).probe('/ignored');
    child.stdout.end(JSON.stringify({ streams: [{ codec_name: 'h264' }] }));
    child.emit('close', 0);

    await expect(result).resolves.toMatchObject({
      streams: [{ codec_name: 'h264' }],
    });
    expect(child.kill).not.toHaveBeenCalled();
    expect(tracker.track).toHaveBeenCalledWith(child);
    expect(tracker.untrack).toHaveBeenCalledWith(child);
  });
});
