import { execFileSync } from 'node:child_process';
import {
  appendFile,
  copyFile,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { EnvironmentConfiguration } from '@posts-media/configuration';
import { MediaType } from '@posts-media/domain';
import * as sharpModule from 'sharp';

import {
  MediaValidationService,
  type FileValidationOutcome,
} from './media-validation.service';

type UploadConfiguration = EnvironmentConfiguration['upload'];

const configuration = (
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

const stagedFile = async (
  path: string,
  originalname: string,
  mimetype: string,
): Promise<Express.Multer.File> => ({
  fieldname: 'files',
  originalname,
  encoding: '7bit',
  mimetype,
  size: (await stat(path)).size,
  destination: join(path, '..'),
  filename: path.split('/').at(-1) ?? 'generated',
  path,
  buffer: Buffer.alloc(0),
  stream: undefined as never,
});

const expectError = (outcome: FileValidationOutcome, code: string): void => {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.error).toMatchObject({ code });
  }
};

describe('MediaValidationService with real parsers', () => {
  let directory: string;
  let jpegPath: string;
  let mp3Path: string;
  let mp4Path: string;
  let m4aPath: string;
  let webmPath: string;
  let mkvPath: string;
  let twoStreamMp4Path: string;
  let decodeHeavyJpegPath: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-orchestrator-'));
    jpegPath = join(directory, 'generated-image');
    mp3Path = join(directory, 'generated-audio');
    mp4Path = join(directory, 'generated-video');
    m4aPath = join(directory, 'generated-m4a');
    webmPath = join(directory, 'generated-webm');
    mkvPath = join(directory, 'generated-mkv');
    twoStreamMp4Path = join(directory, 'generated-two-stream-mp4');
    decodeHeavyJpegPath = join(directory, 'decode-heavy-image');
    const base = ['-hide_banner', '-loglevel', 'error', '-y'];
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=8x8',
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      jpegPath,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=2500x2500',
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-c:v',
      'mjpeg',
      decodeHeavyJpegPath,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=600:duration=1',
      '-c:a',
      'libmp3lame',
      '-f',
      'mp3',
      mp3Path,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=16x12:r=10:d=1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-f',
      'mp4',
      mp4Path,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=600:duration=1',
      '-c:a',
      'aac',
      '-f',
      'ipod',
      m4aPath,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=16x12:r=10:d=1',
      '-c:v',
      'libvpx-vp9',
      '-f',
      'webm',
      webmPath,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=16x12:r=10:d=1',
      '-c:v',
      'libx264',
      '-f',
      'matroska',
      mkvPath,
    ]);
    execFileSync('ffmpeg', [
      ...base,
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=16x12:r=10:d=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=600:duration=1',
      '-shortest',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-f',
      'mp4',
      twoStreamMp4Path,
    ]);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('returns validated uploads for image, audio, and video with real metadata and checksums', async () => {
    const files = await Promise.all([
      stagedFile(jpegPath, ' PHOTO.JPEG ', 'application/octet-stream'),
      stagedFile(mp3Path, 'sound.mp3', 'application/octet-stream'),
      stagedFile(mp4Path, 'movie.mp4', 'application/octet-stream'),
    ]);

    const result = await new MediaValidationService(
      configuration(),
    ).validateFiles(files);

    expect(result.errors).toEqual([]);
    expect(result.validatedUploads).toHaveLength(3);
    expect(result.validatedUploads.map((file) => file.mediaType)).toEqual([
      MediaType.IMAGE,
      MediaType.AUDIO,
      MediaType.VIDEO,
    ]);
    expect(result.validatedUploads[0]).toMatchObject({
      fileIndex: 0,
      originalFilename: 'PHOTO.JPEG',
      extension: 'jpeg',
      declaredMimeType: 'application/octet-stream',
      detectedMimeType: 'image/jpeg',
      detectedFormat: 'jpeg',
      preliminaryMetadata: { width: 8, height: 8, pages: 1 },
    });
    expect(result.validatedUploads[0]?.checksumSha256).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(result.validatedUploads[0]?.sizeBytes).toBe(
      BigInt(files[0]?.size ?? 0),
    );
  });

  it('preserves a valid sibling outcome when another file fails', async () => {
    const unknown = join(directory, 'unknown');
    await writeFile(unknown, Buffer.from('not-media'));
    const result = await new MediaValidationService(
      configuration(),
    ).validateFiles([
      await stagedFile(jpegPath, 'valid.jpg', 'image/jpeg'),
      await stagedFile(unknown, 'invalid.jpg', 'image/jpeg'),
    ]);

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toMatchObject({ ok: true });
    expectError(result.outcomes[1]!, 'UNKNOWN_FILE_SIGNATURE');
    expect(result.validatedUploads).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('does not decode multiple request images concurrently', async () => {
    let maximumProcesses = 0;
    const sample = (): void => {
      maximumProcesses = Math.max(
        maximumProcesses,
        sharpModule.counters().process,
      );
    };
    const timer = setInterval(sample, 0);
    try {
      const result = await new MediaValidationService(
        configuration({ maxImagePixels: 10_000_000 }),
      ).validateFiles(
        await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            stagedFile(decodeHeavyJpegPath, `heavy-${index}.jpg`, 'image/jpeg'),
          ),
        ),
      );
      expect(result.errors).toEqual([]);
    } finally {
      clearInterval(timer);
    }

    expect(maximumProcesses).toBeLessThanOrEqual(1);
  });

  it.each([
    [
      'jpeg renamed as MP4',
      'fake.mp4',
      'video/mp4',
      'jpeg',
      'FILE_SIGNATURE_MISMATCH',
    ],
    [
      'MP4 renamed as JPEG',
      'fake.jpg',
      'image/jpeg',
      'mp4',
      'FILE_SIGNATURE_MISMATCH',
    ],
    ['missing extension', 'README', 'image/jpeg', 'jpeg', 'MISSING_EXTENSION'],
    [
      'unsupported extension',
      'file.gif',
      'image/gif',
      'jpeg',
      'UNSUPPORTED_EXTENSION',
    ],
    [
      'MIME/signature mismatch',
      'file.jpg',
      'video/mp4',
      'jpeg',
      'FILE_SIGNATURE_MISMATCH',
    ],
  ] as const)(
    'rejects %s',
    async (_case, originalname, mimetype, source, code) => {
      const path = source === 'jpeg' ? jpegPath : mp4Path;
      const result = await new MediaValidationService(
        configuration(),
      ).validateFiles([await stagedFile(path, originalname, mimetype)]);

      expectError(result.outcomes[0]!, code);
    },
  );

  it.each([
    ['video MP4 as M4A', 'fake.m4a', 'audio/mp4', 'two-stream-mp4'],
    ['M4A as MP4', 'fake.mp4', 'video/mp4', 'm4a'],
    ['M4A as MOV', 'fake.mov', 'video/quicktime', 'm4a'],
    ['WebM as MKV', 'fake.mkv', 'video/x-matroska', 'webm'],
    ['MKV as WebM', 'fake.webm', 'video/webm', 'mkv'],
  ] as const)(
    'rejects proven container subtype swap: %s',
    async (_case, originalname, mimetype, source) => {
      const paths = {
        'two-stream-mp4': twoStreamMp4Path,
        m4a: m4aPath,
        webm: webmPath,
        mkv: mkvPath,
      } as const;
      const result = await new MediaValidationService(
        configuration(),
      ).validateFiles([
        await stagedFile(paths[source], originalname, mimetype),
      ]);

      expectError(result.outcomes[0]!, 'FILE_SIGNATURE_MISMATCH');
    },
  );

  it('rejects an empty file', async () => {
    const empty = join(directory, 'empty');
    await writeFile(empty, Buffer.alloc(0));
    const result = await new MediaValidationService(
      configuration(),
    ).validateFiles([await stagedFile(empty, 'empty.jpg', 'image/jpeg')]);

    expectError(result.outcomes[0]!, 'EMPTY_FILE');
  });

  it.each([
    ['image', 'large.jpg', 'image/jpeg', 'jpeg', 'maxImageSizeMb'],
    ['audio', 'large.mp3', 'audio/mpeg', 'mp3', 'maxAudioSizeMb'],
    ['video', 'large.mp4', 'video/mp4', 'mp4', 'maxVideoSizeMb'],
  ] as const)(
    'enforces the configured %s byte limit after real parsing',
    async (_type, originalname, mimetype, source, limit) => {
      const path = join(directory, `oversize-${source}`);
      const sourcePath =
        source === 'jpeg' ? jpegPath : source === 'mp3' ? mp3Path : mp4Path;
      await copyFile(sourcePath, path);
      await appendFile(path, Buffer.alloc(1024 * 1024 + 1));
      const result = await new MediaValidationService(
        configuration({ [limit]: 1 }),
      ).validateFiles([await stagedFile(path, originalname, mimetype)]);

      expectError(result.outcomes[0]!, 'FILE_SIZE_EXCEEDED');
    },
  );

  it('rejects decoded-image bombs before body decode even when the file is oversized', async () => {
    const path = join(directory, 'oversize-and-too-many-pixels');
    await copyFile(jpegPath, path);
    await appendFile(path, Buffer.alloc(1024 * 1024 + 1));
    const result = await new MediaValidationService(
      configuration({ maxImageSizeMb: 1, maxImagePixels: 1 }),
    ).validateFiles([await stagedFile(path, 'large.jpg', 'image/jpeg')]);

    expectError(result.outcomes[0]!, 'IMAGE_PIXEL_LIMIT_EXCEEDED');
  });

  it('exposes file-count overflow as a per-file outcome', async () => {
    const result = await new MediaValidationService(
      configuration({ maxFilesPerRequest: 1 }),
    ).validateFiles([
      await stagedFile(jpegPath, 'first.jpg', 'image/jpeg'),
      await stagedFile(jpegPath, 'second.jpg', 'image/jpeg'),
    ]);

    expect(result.outcomes[0]).toMatchObject({ ok: true });
    expectError(result.outcomes[1]!, 'FILE_COUNT_EXCEEDED');
  });

  it('exposes the file that crosses the aggregate size limit without discarding its sibling', async () => {
    const first = join(directory, 'aggregate-first');
    const second = join(directory, 'aggregate-second');
    await Promise.all([copyFile(jpegPath, first), copyFile(jpegPath, second)]);
    await Promise.all([
      appendFile(first, Buffer.alloc(600 * 1024)),
      appendFile(second, Buffer.alloc(600 * 1024)),
    ]);
    const result = await new MediaValidationService(
      configuration({ maxTotalUploadSizeMb: 1 }),
    ).validateFiles([
      await stagedFile(first, 'first.jpg', 'image/jpeg'),
      await stagedFile(second, 'second.jpg', 'image/jpeg'),
    ]);

    expect(result.outcomes[0]).toMatchObject({ ok: true });
    expectError(result.outcomes[1]!, 'TOTAL_UPLOAD_SIZE_EXCEEDED');
  });
});
