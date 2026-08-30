export type NodeEnvironment = 'development' | 'test' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type ProcessingProfile = 'balanced-v1';

export interface EnvironmentConfiguration {
  readonly app: {
    readonly nodeEnvironment: NodeEnvironment;
    readonly port: number;
    readonly apiPrefix: string;
    readonly logLevel: LogLevel;
  };
  readonly database: { readonly url: string };
  readonly redis: { readonly host: string; readonly port: number };
  readonly storage: {
    readonly endpoint: string;
    readonly port: number;
    readonly useSsl: boolean;
    readonly accessKey: string;
    readonly secretKey: string;
    readonly originalsBucket: string;
    readonly processedBucket: string;
    readonly temporaryBucket: string;
    readonly presignedUrlTtlSeconds: number;
  };
  readonly upload: {
    readonly temporaryRoot: string;
    readonly temporaryMaxAgeMinutes: number;
    readonly maxFilesPerRequest: number;
    readonly maxTotalUploadSizeMb: number;
    readonly maxImageSizeMb: number;
    readonly maxAudioSizeMb: number;
    readonly maxVideoSizeMb: number;
    readonly maxImagePixels: number;
    readonly maxAudioDurationSeconds: number;
    readonly maxVideoDurationSeconds: number;
    readonly maxVideoWidth: number;
    readonly maxVideoHeight: number;
    readonly maxMediaStreams: number;
    readonly mediaProbeTimeoutMs: number;
  };
  readonly idempotency: {
    readonly ttlHours: number;
    readonly leaseSeconds: number;
  };
  readonly outbox: {
    readonly pollIntervalMs: number;
    readonly batchSize: number;
    readonly publishConcurrency: number;
    readonly leaseSeconds: number;
    readonly maxRetryDelaySeconds: number;
    readonly publishedRetentionDays: number;
  };
  readonly worker: {
    readonly imageConcurrency: number;
    readonly audioConcurrency: number;
    readonly videoConcurrency: number;
    readonly mediaJobAttempts: number;
    readonly mediaJobBackoffMs: number;
    readonly processingLeaseSeconds: number;
    readonly processingLeaseRenewSeconds: number;
    readonly temporaryRoot: string;
    readonly heartbeatIntervalSeconds: number;
    readonly heartbeatStaleSeconds: number;
  };
  readonly processing: {
    readonly profile: ProcessingProfile;
    readonly imageTimeoutMs: number;
    readonly audioTimeoutMs: number;
    readonly videoTimeoutMs: number;
    readonly imageWebpQuality: number;
    readonly imageMaxWidth: number;
    readonly imageMaxHeight: number;
    readonly imageThumbnailSize: number;
    readonly audioMp3BitrateKbps: number;
    readonly audioMaxSampleRate: number;
    readonly videoMaxFps: number;
    readonly videoH264Crf: number;
    readonly videoH264Preset: 'veryfast';
    readonly videoAudioBitrateKbps: number;
  };
}

export class EnvironmentValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EnvironmentValidationError';
  }
}

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

interface IntegerOptions {
  readonly min: number;
  readonly max?: number;
}

const fail = (name: string, reason: string): never => {
  throw new EnvironmentValidationError(`${name} ${reason}`);
};

const requiredString = (
  environment: EnvironmentInput,
  name: string,
): string => {
  const value = environment[name]?.trim();
  return value === undefined || value.length === 0
    ? fail(name, 'must be set')
    : value;
};

const integer = (
  environment: EnvironmentInput,
  name: string,
  options: IntegerOptions,
): number => {
  const value = requiredString(environment, name);
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return fail(name, 'must be a base-10 integer');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min) {
    return fail(name, `must be at least ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    return fail(name, `must be at most ${options.max}`);
  }
  return parsed;
};

const port = (environment: EnvironmentInput, name: string): number =>
  integer(environment, name, { min: 1, max: 65535 });

const boolean = (environment: EnvironmentInput, name: string): boolean => {
  const value = requiredString(environment, name).toLowerCase();
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fail(name, 'must be either true or false');
};

const oneOf = <T extends string>(
  environment: EnvironmentInput,
  name: string,
  supported: readonly T[],
): T => {
  const value = requiredString(environment, name);
  const supportedValue = supported.find((candidate) => candidate === value);
  return (
    supportedValue ?? fail(name, `must be one of: ${supported.join(', ')}`)
  );
};

export const parseEnvironment = (
  environment: EnvironmentInput = process.env,
): EnvironmentConfiguration => {
  const configuration: EnvironmentConfiguration = {
    app: {
      nodeEnvironment: oneOf(environment, 'NODE_ENV', [
        'development',
        'test',
        'production',
      ]),
      port: port(environment, 'PORT'),
      apiPrefix: requiredString(environment, 'API_PREFIX'),
      logLevel: oneOf(environment, 'LOG_LEVEL', [
        'debug',
        'info',
        'warn',
        'error',
      ]),
    },
    database: { url: requiredString(environment, 'DATABASE_URL') },
    redis: {
      host: requiredString(environment, 'REDIS_HOST'),
      port: port(environment, 'REDIS_PORT'),
    },
    storage: {
      endpoint: requiredString(environment, 'MINIO_ENDPOINT'),
      port: port(environment, 'MINIO_PORT'),
      useSsl: boolean(environment, 'MINIO_USE_SSL'),
      accessKey: requiredString(environment, 'MINIO_ACCESS_KEY'),
      secretKey: requiredString(environment, 'MINIO_SECRET_KEY'),
      originalsBucket: requiredString(environment, 'MINIO_ORIGINALS_BUCKET'),
      processedBucket: requiredString(environment, 'MINIO_PROCESSED_BUCKET'),
      temporaryBucket: requiredString(environment, 'MINIO_TEMP_BUCKET'),
      presignedUrlTtlSeconds: integer(
        environment,
        'MINIO_PRESIGNED_URL_TTL_SECONDS',
        {
          min: 1,
        },
      ),
    },
    upload: {
      temporaryRoot: requiredString(environment, 'UPLOAD_TEMP_ROOT'),
      temporaryMaxAgeMinutes: integer(
        environment,
        'UPLOAD_TEMP_MAX_AGE_MINUTES',
        {
          min: 1,
        },
      ),
      maxFilesPerRequest: integer(environment, 'MAX_FILES_PER_REQUEST', {
        min: 1,
      }),
      maxTotalUploadSizeMb: integer(environment, 'MAX_TOTAL_UPLOAD_SIZE_MB', {
        min: 1,
      }),
      maxImageSizeMb: integer(environment, 'MAX_IMAGE_SIZE_MB', { min: 1 }),
      maxAudioSizeMb: integer(environment, 'MAX_AUDIO_SIZE_MB', { min: 1 }),
      maxVideoSizeMb: integer(environment, 'MAX_VIDEO_SIZE_MB', { min: 1 }),
      maxImagePixels: integer(environment, 'MAX_IMAGE_PIXELS', { min: 1 }),
      maxAudioDurationSeconds: integer(
        environment,
        'MAX_AUDIO_DURATION_SECONDS',
        {
          min: 1,
        },
      ),
      maxVideoDurationSeconds: integer(
        environment,
        'MAX_VIDEO_DURATION_SECONDS',
        {
          min: 1,
        },
      ),
      maxVideoWidth: integer(environment, 'MAX_VIDEO_WIDTH', { min: 1 }),
      maxVideoHeight: integer(environment, 'MAX_VIDEO_HEIGHT', { min: 1 }),
      maxMediaStreams: integer(environment, 'MAX_MEDIA_STREAMS', { min: 1 }),
      mediaProbeTimeoutMs: integer(environment, 'MEDIA_PROBE_TIMEOUT_MS', {
        min: 1,
      }),
    },
    idempotency: {
      ttlHours: integer(environment, 'IDEMPOTENCY_TTL_HOURS', { min: 1 }),
      leaseSeconds: integer(environment, 'IDEMPOTENCY_LEASE_SECONDS', {
        min: 1,
      }),
    },
    outbox: {
      pollIntervalMs: integer(environment, 'OUTBOX_POLL_INTERVAL_MS', {
        min: 1,
      }),
      batchSize: integer(environment, 'OUTBOX_BATCH_SIZE', { min: 1 }),
      publishConcurrency: integer(environment, 'OUTBOX_PUBLISH_CONCURRENCY', {
        min: 1,
      }),
      leaseSeconds: integer(environment, 'OUTBOX_LEASE_SECONDS', { min: 1 }),
      maxRetryDelaySeconds: integer(
        environment,
        'OUTBOX_MAX_RETRY_DELAY_SECONDS',
        {
          min: 1,
        },
      ),
      publishedRetentionDays: integer(
        environment,
        'OUTBOX_PUBLISHED_RETENTION_DAYS',
        {
          min: 1,
        },
      ),
    },
    worker: {
      imageConcurrency: integer(environment, 'IMAGE_WORKER_CONCURRENCY', {
        min: 1,
      }),
      audioConcurrency: integer(environment, 'AUDIO_WORKER_CONCURRENCY', {
        min: 1,
      }),
      videoConcurrency: integer(environment, 'VIDEO_WORKER_CONCURRENCY', {
        min: 1,
      }),
      mediaJobAttempts: integer(environment, 'MEDIA_JOB_ATTEMPTS', { min: 1 }),
      mediaJobBackoffMs: integer(environment, 'MEDIA_JOB_BACKOFF_MS', {
        min: 1,
      }),
      processingLeaseSeconds: integer(environment, 'PROCESSING_LEASE_SECONDS', {
        min: 1,
      }),
      processingLeaseRenewSeconds: integer(
        environment,
        'PROCESSING_LEASE_RENEW_SECONDS',
        { min: 1 },
      ),
      temporaryRoot: requiredString(environment, 'WORKER_TEMP_ROOT'),
      heartbeatIntervalSeconds: integer(
        environment,
        'WORKER_HEARTBEAT_INTERVAL_SECONDS',
        { min: 1 },
      ),
      heartbeatStaleSeconds: integer(
        environment,
        'WORKER_HEARTBEAT_STALE_SECONDS',
        { min: 1 },
      ),
    },
    processing: {
      profile: oneOf(environment, 'PROCESSING_PROFILE', ['balanced-v1']),
      imageTimeoutMs: integer(environment, 'IMAGE_PROCESSING_TIMEOUT_MS', {
        min: 1,
      }),
      audioTimeoutMs: integer(environment, 'AUDIO_PROCESSING_TIMEOUT_MS', {
        min: 1,
      }),
      videoTimeoutMs: integer(environment, 'VIDEO_PROCESSING_TIMEOUT_MS', {
        min: 1,
      }),
      imageWebpQuality: integer(environment, 'IMAGE_WEBP_QUALITY', {
        min: 1,
        max: 100,
      }),
      imageMaxWidth: integer(environment, 'IMAGE_MAX_WIDTH', { min: 1 }),
      imageMaxHeight: integer(environment, 'IMAGE_MAX_HEIGHT', { min: 1 }),
      imageThumbnailSize: integer(environment, 'IMAGE_THUMBNAIL_SIZE', {
        min: 1,
      }),
      audioMp3BitrateKbps: integer(environment, 'AUDIO_MP3_BITRATE_KBPS', {
        min: 1,
      }),
      audioMaxSampleRate: integer(environment, 'AUDIO_MAX_SAMPLE_RATE', {
        min: 1,
      }),
      videoMaxFps: integer(environment, 'VIDEO_MAX_FPS', { min: 1 }),
      videoH264Crf: integer(environment, 'VIDEO_H264_CRF', { min: 0, max: 51 }),
      videoH264Preset: oneOf(environment, 'VIDEO_H264_PRESET', ['veryfast']),
      videoAudioBitrateKbps: integer(environment, 'VIDEO_AUDIO_BITRATE_KBPS', {
        min: 1,
      }),
    },
  };

  if (
    configuration.worker.processingLeaseRenewSeconds >=
    configuration.worker.processingLeaseSeconds
  ) {
    fail(
      'PROCESSING_LEASE_RENEW_SECONDS',
      'must be less than PROCESSING_LEASE_SECONDS',
    );
  }
  if (
    configuration.worker.heartbeatStaleSeconds <=
    configuration.worker.heartbeatIntervalSeconds
  ) {
    fail(
      'WORKER_HEARTBEAT_STALE_SECONDS',
      'must be greater than WORKER_HEARTBEAT_INTERVAL_SECONDS',
    );
  }

  return configuration;
};
