import type { VideoRendition } from './video-rendition-planner';

export interface VideoCommandOptions {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly rendition: VideoRendition;
  readonly hasAudio: boolean;
  readonly crf?: number;
  readonly preset?: string;
  readonly audioBitrateKbps?: number;
  readonly maxFps?: number;
}

export const buildVideoRenditionArgs = (
  options: VideoCommandOptions,
): string[] => [
  '-y',
  '-i',
  options.inputPath,
  '-map',
  '0:v:0',
  ...(options.hasAudio ? ['-map', '0:a:0?'] : []),
  '-vf',
  `scale=${options.rendition.width}:${options.rendition.height}:force_original_aspect_ratio=decrease,fps=${options.maxFps ?? 30},format=yuv420p`,
  '-c:v',
  'libx264',
  '-preset',
  options.preset ?? 'veryfast',
  '-crf',
  String(options.crf ?? 23),
  '-pix_fmt',
  'yuv420p',
  ...(options.hasAudio
    ? ['-c:a', 'aac', '-b:a', `${options.audioBitrateKbps ?? 128}k`]
    : ['-an']),
  '-movflags',
  '+faststart',
  options.outputPath,
];

export const buildVideoThumbnailArgs = (
  inputPath: string,
  outputPath: string,
  timestampSeconds: number,
): string[] => [
  '-y',
  '-ss',
  String(Math.max(0, timestampSeconds)),
  '-i',
  inputPath,
  '-frames:v',
  '1',
  '-q:v',
  '2',
  outputPath,
];
