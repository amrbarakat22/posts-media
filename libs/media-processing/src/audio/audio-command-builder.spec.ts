import { buildAudioNormalizeArgs } from './audio-command-builder';

describe('buildAudioNormalizeArgs', () => {
  it('creates a metadata-free 192k MP3 command and downmixes multichannel input', () => {
    expect(
      buildAudioNormalizeArgs({
        inputPath: '/in.wav',
        outputPath: '/out.mp3',
        channels: 6,
        sampleRate: 96_000,
      }),
    ).toEqual([
      '-y',
      '-i',
      '/in.wav',
      '-map',
      '0:a:0',
      '-vn',
      '-map_metadata',
      '-1',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '/out.mp3',
    ]);
  });
});
