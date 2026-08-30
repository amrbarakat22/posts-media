import {
  EnvironmentValidationError,
  parseEnvironment,
} from './environment.schema';

const validEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  PORT: '3000',
  API_PREFIX: 'api',
  LOG_LEVEL: 'debug',
  DATABASE_URL: 'postgresql://posts:posts@postgres:5432/posts_media',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
  MINIO_ENDPOINT: 'minio',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin123',
  MINIO_ORIGINALS_BUCKET: 'post-originals',
  MINIO_PROCESSED_BUCKET: 'post-processed',
  MINIO_TEMP_BUCKET: 'post-temporary',
  MINIO_PRESIGNED_URL_TTL_SECONDS: '900',
  UPLOAD_TEMP_ROOT: '/tmp/posts-media-api',
  UPLOAD_TEMP_MAX_AGE_MINUTES: '60',
  MAX_FILES_PER_REQUEST: '10',
  MAX_TOTAL_UPLOAD_SIZE_MB: '500',
  MAX_IMAGE_SIZE_MB: '10',
  MAX_AUDIO_SIZE_MB: '50',
  MAX_VIDEO_SIZE_MB: '250',
  MAX_IMAGE_PIXELS: '40000000',
  MAX_AUDIO_DURATION_SECONDS: '7200',
  MAX_VIDEO_DURATION_SECONDS: '1800',
  MAX_VIDEO_WIDTH: '7680',
  MAX_VIDEO_HEIGHT: '4320',
  MAX_MEDIA_STREAMS: '10',
  MEDIA_PROBE_TIMEOUT_MS: '10000',
  IDEMPOTENCY_TTL_HOURS: '24',
  IDEMPOTENCY_LEASE_SECONDS: '900',
  OUTBOX_POLL_INTERVAL_MS: '1000',
  OUTBOX_BATCH_SIZE: '25',
  OUTBOX_PUBLISH_CONCURRENCY: '5',
  OUTBOX_LEASE_SECONDS: '30',
  OUTBOX_MAX_RETRY_DELAY_SECONDS: '60',
  OUTBOX_PUBLISHED_RETENTION_DAYS: '7',
  IMAGE_WORKER_CONCURRENCY: '4',
  AUDIO_WORKER_CONCURRENCY: '2',
  VIDEO_WORKER_CONCURRENCY: '1',
  MEDIA_JOB_ATTEMPTS: '3',
  MEDIA_JOB_BACKOFF_MS: '5000',
  PROCESSING_LEASE_SECONDS: '60',
  PROCESSING_LEASE_RENEW_SECONDS: '20',
  WORKER_TEMP_ROOT: '/tmp/posts-media-worker',
  WORKER_HEARTBEAT_INTERVAL_SECONDS: '10',
  WORKER_HEARTBEAT_STALE_SECONDS: '30',
  IMAGE_PROCESSING_TIMEOUT_MS: '60000',
  AUDIO_PROCESSING_TIMEOUT_MS: '600000',
  VIDEO_PROCESSING_TIMEOUT_MS: '3600000',
  IMAGE_WEBP_QUALITY: '82',
  IMAGE_MAX_WIDTH: '1920',
  IMAGE_MAX_HEIGHT: '1920',
  IMAGE_THUMBNAIL_SIZE: '400',
  AUDIO_MP3_BITRATE_KBPS: '192',
  AUDIO_MAX_SAMPLE_RATE: '48000',
  VIDEO_MAX_FPS: '30',
  VIDEO_H264_CRF: '23',
  VIDEO_H264_PRESET: 'veryfast',
  VIDEO_AUDIO_BITRATE_KBPS: '128',
  PROCESSING_PROFILE: 'balanced-v1',
});

describe('parseEnvironment', () => {
  it('parses the complete supported contract into typed values', () => {
    const configuration = parseEnvironment(validEnvironment());

    expect(configuration.app.port).toBe(3000);
    expect(configuration.storage.useSsl).toBe(false);
    expect(configuration.worker.imageConcurrency).toBe(4);
    expect(configuration.processing.profile).toBe('balanced-v1');
  });

  it.each([
    ['MAX_IMAGE_SIZE_MB', '0'],
    ['MAX_AUDIO_SIZE_MB', '-1'],
    ['MAX_TOTAL_UPLOAD_SIZE_MB', 'not-a-number'],
  ])('rejects invalid positive numeric limit %s=%s', (name, value) => {
    const environment = validEnvironment();
    environment[name] = value;

    expect(() => parseEnvironment(environment)).toThrow(
      EnvironmentValidationError,
    );
    expect(() => parseEnvironment(environment)).toThrow(name);
  });

  it.each(['MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'])(
    'rejects a missing MinIO credential: %s',
    (name) => {
      const environment = validEnvironment();
      delete environment[name];

      expect(() => parseEnvironment(environment)).toThrow(name);
    },
  );

  it.each([
    ['IMAGE_WORKER_CONCURRENCY', '0'],
    ['AUDIO_WORKER_CONCURRENCY', '-2'],
    ['VIDEO_WORKER_CONCURRENCY', '1.5'],
  ])('rejects invalid worker concurrency %s=%s', (name, value) => {
    const environment = validEnvironment();
    environment[name] = value;

    expect(() => parseEnvironment(environment)).toThrow(name);
  });

  it.each([
    ['PORT', '70000'],
    ['REDIS_PORT', '0'],
    ['MINIO_PORT', 'not-a-port'],
  ])('rejects invalid port %s=%s', (name, value) => {
    const environment = validEnvironment();
    environment[name] = value;

    expect(() => parseEnvironment(environment)).toThrow(name);
  });

  it('rejects retry counts below one', () => {
    const environment = validEnvironment();
    environment.MEDIA_JOB_ATTEMPTS = '0';

    expect(() => parseEnvironment(environment)).toThrow('MEDIA_JOB_ATTEMPTS');
  });

  it('rejects processing leases renewed at or after their duration', () => {
    const environment = validEnvironment();
    environment.PROCESSING_LEASE_RENEW_SECONDS = '60';

    expect(() => parseEnvironment(environment)).toThrow(
      'PROCESSING_LEASE_RENEW_SECONDS',
    );
  });

  it('rejects unsupported processing profiles', () => {
    const environment = validEnvironment();
    environment.PROCESSING_PROFILE = 'fast-v1';

    expect(() => parseEnvironment(environment)).toThrow('PROCESSING_PROFILE');
  });
});
