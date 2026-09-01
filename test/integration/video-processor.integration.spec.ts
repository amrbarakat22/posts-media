import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FfmpegService,
  FfprobeService,
  VideoProcessorService,
} from '@posts-media/media-processing';

interface VideoFixture {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly withAudio: boolean;
  readonly expected: readonly string[];
  readonly expectedSizes: Readonly<Record<string, readonly [number, number]>>;
}

const fixtures: readonly VideoFixture[] = [
  {
    name: '1080p landscape with audio',
    width: 1920,
    height: 1080,
    fps: 60,
    withAudio: true,
    expected: ['360p', '720p', '1080p', 'thumbnail'],
    expectedSizes: {
      '360p': [640, 360],
      '720p': [1280, 720],
      '1080p': [1920, 1080],
    },
  },
  {
    name: '720p landscape without audio',
    width: 1280,
    height: 720,
    fps: 24,
    withAudio: false,
    expected: ['360p', '720p', 'thumbnail'],
    expectedSizes: { '360p': [640, 360], '720p': [1280, 720] },
  },
  {
    name: '480p landscape',
    width: 854,
    height: 480,
    fps: 24,
    withAudio: false,
    expected: ['360p', 'thumbnail'],
    expectedSizes: { '360p': [640, 360] },
  },
  {
    name: 'sub-360 landscape',
    width: 320,
    height: 240,
    fps: 24,
    withAudio: false,
    expected: ['source', 'thumbnail'],
    expectedSizes: { source: [320, 240] },
  },
  {
    name: 'portrait video',
    width: 360,
    height: 640,
    fps: 24,
    withAudio: false,
    expected: ['360p', 'thumbnail'],
    expectedSizes: { '360p': [360, 640] },
  },
];

interface RawProbeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly pix_fmt?: string;
  readonly width?: number;
  readonly height?: number;
  readonly avg_frame_rate?: string;
}

interface RawProbe {
  readonly streams: readonly RawProbeStream[];
  readonly format?: { readonly duration?: string };
}

const probe = (path: string): RawProbe =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        path,
      ],
      { encoding: 'utf8' },
    ),
  ) as RawProbe;

const frameRate = (value: string | undefined): number => {
  if (value === undefined) return 0;
  const [numerator = '0', denominator = '1'] = value.split('/');
  return Number(numerator) / Number(denominator);
};

describe('VideoProcessorService real fixture matrix', () => {
  it.each(fixtures)(
    'creates the no-upscale H.264 ladder for $name',
    async (fixture) => {
      const root = await mkdtemp(join(tmpdir(), 'posts-media-video-'));
      const input = join(root, 'input.mp4');
      try {
        const args = [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `testsrc2=size=${fixture.width}x${fixture.height}:rate=${fixture.fps}:duration=0.35`,
        ];
        if (fixture.withAudio) {
          args.push(
            '-f',
            'lavfi',
            '-i',
            'sine=frequency=660:duration=0.35',
            '-shortest',
            '-c:a',
            'aac',
          );
        }
        args.push(
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          input,
        );
        execFileSync('ffmpeg', args, { stdio: 'ignore' });

        const processor = new VideoProcessorService(
          new FfprobeService(),
          new FfmpegService(),
        );
        const outputs = await processor.process(input, root, {
          timeoutMs: 30_000,
        });
        expect(outputs.map((output) => output.label)).toEqual(fixture.expected);

        for (const output of outputs.filter(
          (item) => item.label !== 'thumbnail',
        )) {
          const inspected = probe(output.path);
          const video = inspected.streams.find(
            (stream) => stream.codec_type === 'video',
          );
          const audio = inspected.streams.find(
            (stream) => stream.codec_type === 'audio',
          );
          expect(output.size).toBeGreaterThan(0n);
          expect(Number(inspected.format?.duration)).toBeGreaterThan(0);
          expect(video?.codec_name).toBe('h264');
          expect(video?.pix_fmt).toBe('yuv420p');
          const expectedSize = fixture.expectedSizes[output.label];
          expect([video?.width, video?.height]).toEqual(expectedSize);
          expect(frameRate(video?.avg_frame_rate)).toBeLessThanOrEqual(30);
          if (fixture.withAudio) expect(audio?.codec_name).toBe('aac');
          else expect(audio).toBeUndefined();
        }

        const thumbnail = outputs.find((item) => item.label === 'thumbnail');
        expect(thumbnail?.size).toBeGreaterThan(0n);
        expect(probe(thumbnail!.path).streams[0]?.codec_name).toBe('mjpeg');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('honors display rotation when planning and transcoding renditions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'posts-media-video-rotation-'));
    const encoded = join(root, 'encoded.mp4');
    const input = join(root, 'rotated.mp4');
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
          'testsrc2=size=640x360:rate=24:duration=0.35',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          encoded,
        ],
        { stdio: 'ignore' },
      );
      execFileSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          encoded,
          '-c',
          'copy',
          '-metadata:s:v:0',
          'rotate=90',
          input,
        ],
        { stdio: 'ignore' },
      );

      const processor = new VideoProcessorService(
        new FfprobeService(),
        new FfmpegService(),
      );
      const outputs = await processor.process(input, root, {
        timeoutMs: 30_000,
      });
      const rendition = outputs.find((output) => output.label === '360p');
      expect(rendition).toBeDefined();
      const video = probe(rendition!.path).streams.find(
        (stream) => stream.codec_type === 'video',
      );
      expect([video?.width, video?.height]).toEqual([360, 640]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
