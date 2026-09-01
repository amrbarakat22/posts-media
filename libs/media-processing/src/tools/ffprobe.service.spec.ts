import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ChildProcessTracker } from './ffmpeg.service';
import { FfprobeService } from './ffprobe.service';

describe('FfprobeService subprocess safety', () => {
  let root: string;
  let binary: string;
  let tracker: ChildProcessTracker;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ffprobe-controlled-'));
    binary = join(root, 'controlled-probe');
    tracker = {
      track: jest.fn((child) => child),
      untrack: jest.fn(),
    };
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  const executable = async (source: string): Promise<void> => {
    await writeFile(binary, `#!/usr/bin/env node\n${source}\n`, {
      mode: 0o755,
    });
  };

  it('rejects oversized output after terminating and untracking the child', async () => {
    await executable(
      `process.stderr.write('oversized'); setInterval(() => undefined, 1000);`,
    );

    await expect(
      new FfprobeService(tracker).probe('/ignored', {
        binary,
        maxOutputBytes: 1,
      }),
    ).rejects.toThrow('FFPROBE_OUTPUT_LIMIT');
    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.untrack).toHaveBeenCalledTimes(1);
  });

  it('rejects a timeout after terminating and untracking the child', async () => {
    await executable(`setInterval(() => undefined, 1000);`);

    await expect(
      new FfprobeService(tracker).probe('/ignored', {
        binary,
        timeoutMs: 25,
      }),
    ).rejects.toThrow('MEDIA_VALIDATION_TIMEOUT');
    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.untrack).toHaveBeenCalledTimes(1);
  });

  it('parses controlled output and untracks a successful child', async () => {
    await executable(
      `process.stdout.write(JSON.stringify({ streams: [{ codec_name: 'h264' }] }));`,
    );

    await expect(
      new FfprobeService(tracker).probe('/ignored', { binary }),
    ).resolves.toMatchObject({ streams: [{ codec_name: 'h264' }] });
    expect(tracker.track).toHaveBeenCalledTimes(1);
    expect(tracker.untrack).toHaveBeenCalledTimes(1);
  });
});
