export interface AudioCommandOptions {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bitrateKbps?: number;
}

export const buildAudioNormalizeArgs = (
  options: AudioCommandOptions,
): string[] => [
  '-y',
  '-i',
  options.inputPath,
  '-map',
  '0:a:0',
  '-vn',
  '-map_metadata',
  '-1',
  '-c:a',
  'libmp3lame',
  '-b:a',
  `${options.bitrateKbps ?? 192}k`,
  '-ar',
  String(Math.min(options.sampleRate, 48_000)),
  '-ac',
  String(Math.min(Math.max(options.channels, 1), 2)),
  options.outputPath,
];
