import { stat } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';

import { FfmpegService } from '../tools/ffmpeg.service';
import { FfprobeService } from '../tools/ffprobe.service';
import {
  buildVideoRenditionArgs,
  buildVideoThumbnailArgs,
} from './video-command-builder';
import {
  planVideoRenditions,
  type VideoRendition,
} from './video-rendition-planner';

export interface VideoOutput {
  readonly path: string;
  readonly label: VideoRendition['label'] | 'thumbnail';
  readonly size: bigint;
}

@Injectable()
export class VideoProcessorService {
  public constructor(
    private readonly probe: FfprobeService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  public async process(
    inputPath: string,
    workspace: string,
    options: { timeoutMs?: number } = {},
  ): Promise<VideoOutput[]> {
    const source = await this.probe.probe(inputPath);
    const video = source.streams.find((item) => item.codec_type === 'video');
    if (video?.width === undefined || video.height === undefined)
      throw new Error('MEDIA_STREAM_NOT_FOUND');
    const hasAudio = source.streams.some((item) => item.codec_type === 'audio');
    const renditions = planVideoRenditions(video.width, video.height);
    const outputs: VideoOutput[] = [];
    for (const rendition of renditions) {
      const outputPath = `${workspace}/video-${rendition.label}.mp4`;
      await this.ffmpeg.run(
        buildVideoRenditionArgs({ inputPath, outputPath, rendition, hasAudio }),
        { timeoutMs: options.timeoutMs },
      );
      outputs.push({
        path: outputPath,
        label: rendition.label,
        size: BigInt((await stat(outputPath)).size),
      });
    }
    const duration = Number(source.format?.duration ?? video.duration ?? 0);
    const thumbnailPath = `${workspace}/thumbnail.jpg`;
    await this.ffmpeg.run(
      buildVideoThumbnailArgs(
        inputPath,
        thumbnailPath,
        Number.isFinite(duration) ? duration * 0.1 : 0,
      ),
    );
    outputs.push({
      path: thumbnailPath,
      label: 'thumbnail',
      size: BigInt((await stat(thumbnailPath)).size),
    });
    return outputs;
  }
}
