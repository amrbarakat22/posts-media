import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EnvironmentConfiguration } from '@posts-media/configuration';
import { MediaType } from '@posts-media/domain';

import { AvInspectorService } from './av-inspector.service';

type UploadConfiguration = EnvironmentConfiguration['upload'];

const limits = (
  overrides: Partial<UploadConfiguration> = {},
): UploadConfiguration => ({
  temporaryRoot: '/unused',
  temporaryMaxAgeMinutes: 60,
  maxFilesPerRequest: 10,
  maxTotalUploadSizeMb: 500,
  maxImageSizeMb: 10,
  maxAudioSizeMb: 50,
  maxVideoSizeMb: 250,
  maxImagePixels: 40_000_000,
  maxAudioDurationSeconds: 7_200,
  maxVideoDurationSeconds: 1_800,
  maxVideoWidth: 7_680,
  maxVideoHeight: 4_320,
  maxMediaStreams: 10,
  mediaProbeTimeoutMs: 10_000,
  ...overrides,
});

const ffmpeg = (directory: string, args: readonly string[]): void => {
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { cwd: directory },
  );
};

describe('AvInspectorService with real FFprobe parsing', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-av-'));
    const sine = ['-f', 'lavfi', '-i', 'sine=frequency=800:duration=1.2'];
    ffmpeg(directory, [...sine, '-c:a', 'libmp3lame', 'valid.mp3']);
    ffmpeg(directory, [...sine, '-c:a', 'pcm_s16le', 'valid.wav']);
    ffmpeg(directory, [...sine, '-c:a', 'aac', 'valid.m4a']);
    ffmpeg(directory, [...sine, '-c:a', 'aac', '-f', 'adts', 'valid.aac']);
    ffmpeg(directory, [...sine, '-c:a', 'flac', 'valid.flac']);
    ffmpeg(directory, [...sine, '-c:a', 'libvorbis', 'valid.ogg']);
    ffmpeg(directory, [...sine, '-c:a', 'alac', 'unsupported-audio.m4a']);

    const video = ['-f', 'lavfi', '-i', 'color=c=blue:s=16x12:r=10:d=1.2'];
    ffmpeg(directory, [
      ...video,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      'valid.mp4',
    ]);
    ffmpeg(directory, [
      ...video,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      'valid.mov',
    ]);
    ffmpeg(directory, [...video, '-c:v', 'libvpx-vp9', 'valid.webm']);
    ffmpeg(directory, [...video, '-c:v', 'libx264', 'valid.mkv']);
    ffmpeg(directory, [...video, '-c:v', 'mpeg4', 'unsupported-video.mp4']);
    ffmpeg(directory, [
      ...video,
      ...sine,
      '-shortest',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      'two-streams.mp4',
    ]);
    const mp3 = await readFile(join(directory, 'valid.mp3'));
    await writeFile(join(directory, 'truncated.mp3'), mp3.subarray(0, 24));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['valid.mp3', MediaType.AUDIO, 'mp3', 'audio/mpeg'],
    ['valid.wav', MediaType.AUDIO, 'wav', 'audio/wav'],
    ['valid.m4a', MediaType.AUDIO, 'm4a', 'audio/mp4'],
    ['valid.aac', MediaType.AUDIO, 'aac', 'audio/aac'],
    ['valid.flac', MediaType.AUDIO, 'flac', 'audio/flac'],
    ['valid.ogg', MediaType.AUDIO, 'ogg', 'audio/ogg'],
    ['valid.mp4', MediaType.VIDEO, 'mp4', 'video/mp4'],
    ['valid.mov', MediaType.VIDEO, 'mov', 'video/quicktime'],
    ['valid.webm', MediaType.VIDEO, 'webm', 'video/webm'],
    ['valid.mkv', MediaType.VIDEO, 'mkv', 'video/x-matroska'],
  ] as const)(
    'accepts real %s parser output',
    async (name, mediaType, format, mimeType) => {
      const result = await new AvInspectorService(limits()).inspect(
        join(directory, name),
        { mediaType, expectedFormat: format },
      );

      expect(result).toMatchObject({ format, mimeType });
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(result.streamCount).toBeGreaterThan(0);
    },
  );

  it('refines an ambiguous ISO BMFF container as audio from its streams', async () => {
    await expect(
      new AvInspectorService(limits()).inspect(join(directory, 'valid.m4a'), {
        mediaType: MediaType.AUDIO,
        expectedFormat: 'm4a',
      }),
    ).resolves.toMatchObject({ format: 'm4a', mimeType: 'audio/mp4' });
  });

  it.each([
    ['truncated.mp3', MediaType.AUDIO, 'mp3', 'CORRUPTED_FILE'],
    [
      'unsupported-audio.m4a',
      MediaType.AUDIO,
      'm4a',
      'UNSUPPORTED_AUDIO_CODEC',
    ],
    [
      'unsupported-video.mp4',
      MediaType.VIDEO,
      'mp4',
      'UNSUPPORTED_VIDEO_CODEC',
    ],
    ['valid.m4a', MediaType.VIDEO, 'mp4', 'MEDIA_STREAM_NOT_FOUND'],
  ] as const)(
    'rejects invalid real fixture %s with %s',
    async (name, mediaType, format, code) => {
      await expect(
        new AvInspectorService(limits()).inspect(join(directory, name), {
          mediaType,
          expectedFormat: format,
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it.each([
    [{ maxAudioDurationSeconds: 1 }, 'valid.mp3', MediaType.AUDIO, 'mp3'],
    [{ maxVideoDurationSeconds: 1 }, 'valid.mp4', MediaType.VIDEO, 'mp4'],
    [{ maxVideoWidth: 15 }, 'valid.mp4', MediaType.VIDEO, 'mp4'],
    [{ maxVideoHeight: 11 }, 'valid.mp4', MediaType.VIDEO, 'mp4'],
    [{ maxMediaStreams: 1 }, 'two-streams.mp4', MediaType.VIDEO, 'mp4'],
  ] as const)(
    'enforces configured safety limit %#',
    async (override, name, mediaType, format) => {
      await expect(
        new AvInspectorService(limits(override)).inspect(
          join(directory, name),
          {
            mediaType,
            expectedFormat: format,
          },
        ),
      ).rejects.toMatchObject({ code: 'FILE_SIZE_EXCEEDED' });
    },
  );
});
