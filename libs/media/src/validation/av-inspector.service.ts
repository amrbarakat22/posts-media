import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import {
  type EnvironmentConfiguration,
  mediaToolConfig,
} from '@posts-media/configuration';
import { DomainError, MediaType } from '@posts-media/domain';

import {
  SignatureDetectorService,
  type SignatureDetection,
} from './signature-detector.service';

export interface ProbeProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'close', listener: (code: number | null) => void): this;
  kill(signal: NodeJS.Signals): boolean;
}

interface ProbeSpawnOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: ['ignore', 'pipe', 'pipe'];
}

export type ProbeSpawner = (
  binary: string,
  arguments_: readonly string[],
  options: ProbeSpawnOptions,
) => ProbeProcess;

export interface AvInspectionRequest {
  readonly mediaType: MediaType.AUDIO | MediaType.VIDEO;
  readonly expectedFormat: string;
}

export interface AvInspection {
  readonly format: string;
  readonly mimeType: string;
  readonly durationSeconds: number;
  readonly streamCount: number;
  readonly audioCodec?: string;
  readonly videoCodec?: string;
  readonly width?: number;
  readonly height?: number;
}

interface ProbeStream {
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: string;
}

interface ProbeDocument {
  readonly format?: {
    readonly format_name?: string;
    readonly duration?: string;
  };
  readonly streams?: readonly ProbeStream[];
}

const MAX_PROBE_OUTPUT_BYTES = 1024 * 1024;
const supportedAudioCodecs = new Set(['aac', 'flac', 'mp3', 'opus', 'vorbis']);
const supportedVideoCodecs = new Set(['av1', 'h264', 'hevc', 'vp8', 'vp9']);

const defaultSpawner: ProbeSpawner = (binary, arguments_, options) =>
  spawn(binary, arguments_, options) as unknown as ProbeProcess;

export class AvInspectorService {
  private readonly signatureDetector = new SignatureDetectorService();

  public constructor(
    private readonly configuration: EnvironmentConfiguration['upload'],
    private readonly ffprobeBinary = mediaToolConfig.ffprobeBinary,
    private readonly spawnProbe: ProbeSpawner = defaultSpawner,
  ) {}

  public async inspect(
    temporaryPath: string,
    request: AvInspectionRequest,
    enforceSafetyLimits = true,
  ): Promise<AvInspection> {
    const document = await this.probe(temporaryPath);
    const signature = await this.signatureDetector.detect(temporaryPath);
    const inspection = this.validateDocument(document, request, signature);
    if (enforceSafetyLimits) this.assertSafety(inspection, request.mediaType);
    return inspection;
  }

  public assertSafety(
    inspection: AvInspection,
    mediaType: MediaType.AUDIO | MediaType.VIDEO,
  ): void {
    if (inspection.streamCount > this.configuration.maxMediaStreams) {
      throw safetyLimit(
        'streamCount',
        inspection.streamCount,
        this.configuration.maxMediaStreams,
      );
    }
    const maximumDuration =
      mediaType === MediaType.AUDIO
        ? this.configuration.maxAudioDurationSeconds
        : this.configuration.maxVideoDurationSeconds;
    if (inspection.durationSeconds > maximumDuration) {
      throw safetyLimit(
        'durationSeconds',
        inspection.durationSeconds,
        maximumDuration,
      );
    }
    if (mediaType === MediaType.VIDEO) {
      if (
        inspection.width !== undefined &&
        inspection.width > this.configuration.maxVideoWidth
      ) {
        throw safetyLimit(
          'width',
          inspection.width,
          this.configuration.maxVideoWidth,
        );
      }
      if (
        inspection.height !== undefined &&
        inspection.height > this.configuration.maxVideoHeight
      ) {
        throw safetyLimit(
          'height',
          inspection.height,
          this.configuration.maxVideoHeight,
        );
      }
    }
  }

  private async probe(temporaryPath: string): Promise<ProbeDocument> {
    const arguments_ = [
      '-v',
      'error',
      '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name,width,height,duration',
      '-of',
      'json',
      '--',
      temporaryPath,
    ];

    return new Promise<ProbeDocument>((resolve, reject) => {
      let child: ProbeProcess;
      try {
        child = this.spawnProbe(this.ffprobeBinary, arguments_, {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        reject(corruptedMedia());
        return;
      }

      let stdout = Buffer.alloc(0);
      let capturedBytes = 0;
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() =>
          reject(
            new DomainError(
              'MEDIA_VALIDATION_TIMEOUT',
              'Media validation exceeded the configured time limit.',
              422,
            ),
          ),
        );
      }, this.configuration.mediaProbeTimeoutMs);
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        action();
      };
      const consume = (chunk: Buffer | string, capture: boolean): void => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        capturedBytes += bytes.length;
        if (capturedBytes > MAX_PROBE_OUTPUT_BYTES) {
          child.kill('SIGKILL');
          settle(() => reject(corruptedMedia()));
          return;
        }
        if (capture) stdout = Buffer.concat([stdout, bytes]);
      };

      child.stdout.on('data', (chunk: Buffer | string) => consume(chunk, true));
      child.stderr.on('data', (chunk: Buffer | string) =>
        consume(chunk, false),
      );
      child.once('error', () => settle(() => reject(corruptedMedia())));
      child.once('close', (code) => {
        settle(() => {
          if (code !== 0) {
            reject(corruptedMedia());
            return;
          }
          try {
            resolve(JSON.parse(stdout.toString('utf8')) as ProbeDocument);
          } catch {
            reject(corruptedMedia());
          }
        });
      });
    });
  }

  private validateDocument(
    document: ProbeDocument,
    request: AvInspectionRequest,
    signature: SignatureDetection,
  ): AvInspection {
    const streams = document.streams ?? [];
    const audioStreams = streams.filter(
      (stream) => stream.codec_type === 'audio',
    );
    const videoStreams = streams.filter(
      (stream) => stream.codec_type === 'video',
    );
    const formatNames = new Set(
      (document.format?.format_name ?? '').split(',').filter(Boolean),
    );
    const actualFormat = deriveFormat(signature, audioStreams, videoStreams);
    if (
      actualFormat === undefined ||
      actualFormat !== request.expectedFormat ||
      !containerMatches(actualFormat, formatNames)
    ) {
      throw fileSignatureMismatch(actualFormat);
    }
    if (mediaTypeForFormat(actualFormat) !== request.mediaType) {
      throw fileSignatureMismatch(actualFormat);
    }

    const requiredStreams =
      request.mediaType === MediaType.AUDIO ? audioStreams : videoStreams;
    if (requiredStreams.length === 0) {
      throw new DomainError(
        'MEDIA_STREAM_NOT_FOUND',
        'The uploaded media does not contain the required media stream.',
        422,
      );
    }
    if (!streamContractMatches(actualFormat, audioStreams, videoStreams)) {
      throw fileSignatureMismatch(actualFormat);
    }

    for (const stream of audioStreams) {
      const codec = stream.codec_name;
      if (codec === undefined) throw corruptedMedia();
      if (!codec.startsWith('pcm_') && !supportedAudioCodecs.has(codec)) {
        throw new DomainError(
          'UNSUPPORTED_AUDIO_CODEC',
          'The uploaded audio codec is not supported.',
          422,
          { codec },
        );
      }
    }

    for (const stream of videoStreams) {
      const codec = stream.codec_name;
      if (codec === undefined) throw corruptedMedia();
      if (!supportedVideoCodecs.has(codec)) {
        throw new DomainError(
          'UNSUPPORTED_VIDEO_CODEC',
          'The uploaded video codec is not supported.',
          422,
          { codec },
        );
      }
    }

    const audioCodec = audioStreams[0]?.codec_name;
    const videoCodec = videoStreams[0]?.codec_name;

    const durationSeconds = mediaDuration(document, requiredStreams);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw corruptedMedia();
    }
    const videoDimensions = videoStreams.map((stream) => ({
      width: stream.width,
      height: stream.height,
    }));
    const width = maximumDefined(videoDimensions.map((value) => value.width));
    const height = maximumDefined(videoDimensions.map((value) => value.height));
    if (request.mediaType === MediaType.VIDEO) {
      if (
        videoDimensions.some(
          (value) =>
            !validDimension(value.width) || !validDimension(value.height),
        )
      ) {
        throw corruptedMedia();
      }
    }

    return {
      format: actualFormat,
      mimeType: mimeForFormat(actualFormat),
      durationSeconds,
      streamCount: streams.length,
      ...(audioCodec === undefined ? {} : { audioCodec }),
      ...(videoCodec === undefined ? {} : { videoCodec }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    };
  }
}

const containerMatches = (
  expectedFormat: string,
  actual: ReadonlySet<string>,
): boolean => {
  const expected: Readonly<Record<string, readonly string[]>> = {
    mp3: ['mp3'],
    wav: ['wav'],
    m4a: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
    aac: ['aac'],
    flac: ['flac'],
    ogg: ['ogg'],
    mp4: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
    mov: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
    webm: ['matroska', 'webm'],
    mkv: ['matroska', 'webm'],
  };
  return (expected[expectedFormat] ?? []).some((name) => actual.has(name));
};

const deriveFormat = (
  signature: SignatureDetection,
  audioStreams: readonly ProbeStream[],
  videoStreams: readonly ProbeStream[],
): string | undefined => {
  if (signature.containerFamily === 'iso-bmff') {
    if (
      signature.containerVariant === 'mov' ||
      signature.containerVariant === 'm4a'
    ) {
      return signature.containerVariant;
    }
    if (signature.containerEvidence !== 'shared-iso') return undefined;
    if (videoStreams.length > 0) return 'mp4';
    return audioStreams.length > 0 ? 'm4a' : undefined;
  }
  if (signature.containerFamily === 'ebml') {
    return signature.containerVariant;
  }
  return signature.format;
};

const streamContractMatches = (
  format: string,
  audioStreams: readonly ProbeStream[],
  videoStreams: readonly ProbeStream[],
): boolean =>
  format === 'm4a' ||
  format === 'mp3' ||
  format === 'wav' ||
  format === 'aac' ||
  format === 'flac' ||
  format === 'ogg'
    ? audioStreams.length > 0 && videoStreams.length === 0
    : videoStreams.length > 0;

const mediaTypeForFormat = (
  format: string,
): MediaType.AUDIO | MediaType.VIDEO | undefined =>
  format === 'm4a' ||
  format === 'mp3' ||
  format === 'wav' ||
  format === 'aac' ||
  format === 'flac' ||
  format === 'ogg'
    ? MediaType.AUDIO
    : format === 'mp4' ||
        format === 'mov' ||
        format === 'webm' ||
        format === 'mkv'
      ? MediaType.VIDEO
      : undefined;

const fileSignatureMismatch = (detectedFormat?: string): DomainError =>
  new DomainError(
    'FILE_SIGNATURE_MISMATCH',
    'The uploaded content does not match the submitted media format.',
    422,
    detectedFormat === undefined
      ? undefined
      : {
          detectedFormat,
          detectedMimeType: mimeForFormat(detectedFormat),
        },
  );

const mimeForFormat = (format: string): string => {
  const mimeTypes: Readonly<Record<string, string>> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
  };
  return mimeTypes[format] ?? 'application/octet-stream';
};

const mediaDuration = (
  document: ProbeDocument,
  streams: readonly ProbeStream[],
): number => {
  const formatDuration = Number(document.format?.duration);
  if (Number.isFinite(formatDuration)) return formatDuration;
  return streams.reduce(
    (maximum, stream) => Math.max(maximum, Number(stream.duration)),
    Number.NEGATIVE_INFINITY,
  );
};

const validDimension = (value: number | undefined): value is number =>
  value !== undefined && Number.isInteger(value) && value > 0;

const maximumDefined = (
  values: readonly (number | undefined)[],
): number | undefined => {
  let maximum: number | undefined;
  for (const value of values) {
    if (value !== undefined && (maximum === undefined || value > maximum)) {
      maximum = value;
    }
  }
  return maximum;
};

const safetyLimit = (
  field: string,
  actual: number,
  maximum: number,
): DomainError =>
  new DomainError(
    'FILE_SIZE_EXCEEDED',
    'The uploaded media exceeds a configured safety limit.',
    422,
    { field, actual, maximum },
  );

const corruptedMedia = (): DomainError =>
  new DomainError(
    'CORRUPTED_FILE',
    'The uploaded media could not be inspected.',
    422,
  );
