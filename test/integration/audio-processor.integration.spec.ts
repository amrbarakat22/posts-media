import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AudioProcessorService,
  FfmpegService,
  FfprobeService,
} from '@posts-media/media-processing';

interface AudioFixture {
  readonly name: string;
  readonly extension: string;
  readonly codecArgs: readonly string[];
  readonly inputChannels: number;
  readonly sampleRate: number;
}

const fixtures: readonly AudioFixture[] = [
  {
    name: 'MP3 stereo',
    extension: 'mp3',
    codecArgs: ['-c:a', 'libmp3lame', '-b:a', '96k'],
    inputChannels: 2,
    sampleRate: 44_100,
  },
  {
    name: 'WAV mono at 96 kHz',
    extension: 'wav',
    codecArgs: ['-c:a', 'pcm_s16le'],
    inputChannels: 1,
    sampleRate: 96_000,
  },
  {
    name: 'M4A/AAC stereo',
    extension: 'm4a',
    codecArgs: ['-c:a', 'aac', '-b:a', '96k'],
    inputChannels: 2,
    sampleRate: 48_000,
  },
  {
    name: 'FLAC stereo',
    extension: 'flac',
    codecArgs: ['-c:a', 'flac'],
    inputChannels: 2,
    sampleRate: 48_000,
  },
  {
    name: 'OGG/Vorbis multichannel',
    extension: 'ogg',
    codecArgs: ['-c:a', 'libvorbis', '-q:a', '3'],
    inputChannels: 6,
    sampleRate: 48_000,
  },
];

describe('AudioProcessorService real fixture matrix', () => {
  it.each(fixtures)(
    'normalizes $name to a playable, metadata-sanitized MP3',
    async (fixture) => {
      const root = await mkdtemp(join(tmpdir(), 'posts-media-audio-'));
      const input = join(root, `input.${fixture.extension}`);
      const output = join(root, 'output.mp3');
      try {
        execFileSync(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=440:duration=0.35',
            '-ac',
            String(fixture.inputChannels),
            '-ar',
            String(fixture.sampleRate),
            '-metadata',
            'title=private fixture title',
            ...fixture.codecArgs,
            input,
          ],
          { stdio: 'ignore' },
        );

        const probe = new FfprobeService();
        const processor = new AudioProcessorService(probe, new FfmpegService());
        const result = await processor.process(input, output, {
          bitrateKbps: 192,
          maxSampleRate: 48_000,
        });
        const outputProbe = await probe.probe(output);
        const outputStream = outputProbe.streams.find(
          (stream) => stream.codec_type === 'audio',
        );

        expect(result.outputSize).toBeGreaterThan(0n);
        expect(result.durationSeconds).not.toBeNull();
        expect(result.durationSeconds).toBeGreaterThan(0);
        expect(result.channels).toBe(Math.min(fixture.inputChannels, 2));
        expect(result.sampleRate).toBeLessThanOrEqual(48_000);
        expect(outputStream?.codec_name).toBe('mp3');
        expect(Number(outputProbe.format?.bit_rate)).toBeGreaterThan(150_000);
        expect(Number(outputProbe.format?.bit_rate)).toBeLessThan(230_000);
        expect(JSON.stringify(outputProbe)).not.toContain(
          'private fixture title',
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('rejects a truncated input instead of producing a partial output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'posts-media-audio-corrupt-'));
    const input = join(root, 'truncated.mp3');
    const output = join(root, 'output.mp3');
    try {
      await writeFile(input, Buffer.from('ID3'));
      const processor = new AudioProcessorService(
        new FfprobeService(),
        new FfmpegService(),
      );
      await expect(processor.process(input, output)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
