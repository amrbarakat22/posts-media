import { buildVideoRenditionArgs } from './video-command-builder';

describe('buildVideoRenditionArgs', () => {
  it('builds an H264/AAC fast-start command', () => {
    const args = buildVideoRenditionArgs({
      inputPath: '/in.mp4',
      outputPath: '/out.mp4',
      rendition: { label: '720p', width: 1280, height: 720 },
      hasAudio: true,
    });
    expect(args).toEqual(
      expect.arrayContaining([
        '-c:v',
        'libx264',
        '-crf',
        '23',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
      ]),
    );
  });
});
