import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AudioProcessorService,
  FfmpegService,
  FfprobeService,
} from '@posts-media/media-processing';

describe('AudioProcessorService', () => {
  it('converts a real WAV fixture to MP3 and probes the output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'posts-media-audio-'));
    const input = join(root, 'input.wav');
    const output = join(root, 'output.mp3');
    try {
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=0.25',
          '-ac',
          '1',
          '-ar',
          '96000',
          input,
        ],
        { stdio: 'ignore' },
      );
      const processor = new AudioProcessorService(
        new FfprobeService(),
        new FfmpegService(),
      );
      const result = await processor.process(input, output, {
        maxSampleRate: 48_000,
      });
      expect(result.outputSize).toBeGreaterThan(0n);
      expect(result.channels).toBe(1);
      expect(result.sampleRate).toBeLessThanOrEqual(48_000);
      expect(result.durationSeconds).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
