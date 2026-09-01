interface TestInfrastructureTargets {
  readonly databaseUrl?: string;
  readonly redisHost?: string;
  readonly minioEndpoint?: string;
  readonly queuePrefix?: string;
}

const LOCAL_TEST_HOSTS = new Set([
  'postgres',
  'redis',
  'minio',
  'localhost',
  '127.0.0.1',
]);

export const assertTestInfrastructure = (
  targets: TestInfrastructureTargets,
): void => {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Destructive infrastructure tests require NODE_ENV=test.');

  if (targets.databaseUrl !== undefined) {
    const database = new URL(targets.databaseUrl);
    const databaseName = database.pathname.replace(/^\//, '');
    if (
      !databaseName.endsWith('_test') ||
      !LOCAL_TEST_HOSTS.has(database.hostname)
    ) {
      throw new Error(
        'Destructive database tests require a local *_test database.',
      );
    }
  }

  if (targets.redisHost !== undefined || targets.queuePrefix !== undefined) {
    if (
      targets.redisHost === undefined ||
      targets.queuePrefix === undefined ||
      !LOCAL_TEST_HOSTS.has(targets.redisHost) ||
      !targets.queuePrefix.startsWith('posts-media-test:')
    ) {
      throw new Error(
        'Destructive queue tests require local Redis and a posts-media-test queue prefix.',
      );
    }
  }

  if (
    targets.minioEndpoint !== undefined &&
    !LOCAL_TEST_HOSTS.has(targets.minioEndpoint)
  ) {
    throw new Error('Destructive storage tests require local MinIO.');
  }
};
