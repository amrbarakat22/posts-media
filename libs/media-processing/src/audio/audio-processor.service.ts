import { stat } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';

import { buildAudioNormalizeArgs } from './audio-command-builder';
import { FfmpegService } from '../tools/ffmpeg.service';
import { FfprobeService, type ProbeResult } from '../tools/ffprobe.service';

export interface AudioProcessingResult {
  readonly outputPath: string;
  readonly input: ProbeResult;
  readonly outputSize: bigint;
  readonly durationSeconds: number | null;
  readonly channels: number;
  readonly sampleRate: number | null;
}

@Injectable()
export class AudioProcessorService {
  public constructor(
    private readonly probeService: FfprobeService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  public async process(
    inputPath: string,
    outputPath: string,
    options: {
      bitrateKbps?: number;
      maxSampleRate?: number;
      timeoutMs?: number;
    } = {},
  ): Promise<AudioProcessingResult> {
    const input = await this.probeService.probe(inputPath);
    const stream = input.streams.find((item) => item.codec_type === 'audio');
    if (stream === undefined) throw new Error('MEDIA_STREAM_NOT_FOUND');
    const channels = stream.channels ?? 2;
    const sampleRate = Number(stream.sample_rate ?? 48_000);
    await this.ffmpeg.run(
      buildAudioNormalizeArgs({
        inputPath,
        outputPath,
        channels,
        sampleRate: Math.min(sampleRate, options.maxSampleRate ?? 48_000),
        bitrateKbps: options.bitrateKbps ?? 192,
      }),
      { timeoutMs: options.timeoutMs },
    );
    const output = await this.probeService.probe(outputPath);
    const outputStream = output.streams.find(
      (item) => item.codec_type === 'audio',
    );
    if (outputStream?.codec_name !== 'mp3')
      throw new Error('PROCESSING_OUTPUT_INVALID');
    const details = await stat(outputPath);
    return {
      outputPath,
      input,
      outputSize: BigInt(details.size),
      durationSeconds:
        output.format?.duration === undefined
          ? null
          : Number(output.format.duration),
      channels: outputStream.channels ?? 2,
      sampleRate:
        outputStream.sample_rate === undefined
          ? null
          : Number(outputStream.sample_rate),
    };
  }
}
