import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { ConfigurationModule } from '@posts-media/configuration';
import { Client } from 'minio';

import {
  validEnvironment,
  withEnvironment,
} from '../../../test/support/environment';

import { StorageModule } from './storage.module';

const endpoint = process.env.MINIO_ENDPOINT ?? 'minio';
const port = Number(process.env.MINIO_PORT ?? '9000');
const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin123';

const client = new Client({
  endPoint: endpoint,
  port,
  useSSL: false,
  accessKey,
  secretKey,
});

const buildEnvironment = (overrides: NodeJS.ProcessEnv = {}) =>
  validEnvironment({
    MINIO_ENDPOINT: endpoint,
    MINIO_PORT: String(port),
    MINIO_ACCESS_KEY: accessKey,
    MINIO_SECRET_KEY: secretKey,
    MINIO_ORIGINALS_BUCKET: 'post-originals',
    MINIO_PROCESSED_BUCKET: 'post-processed',
    MINIO_TEMP_BUCKET: 'post-temporary',
    ...overrides,
  });

describe('StorageModule startup checks', () => {
  it('initializes successfully when all three buckets exist and are private', async () => {
    await withEnvironment(buildEnvironment(), async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ConfigurationModule, StorageModule],
      }).compile();

      await expect(moduleRef.init()).resolves.toBeDefined();
      await moduleRef.close();
    });
  });

  it('fails startup when a required bucket does not exist', async () => {
    await withEnvironment(
      buildEnvironment({
        MINIO_TEMP_BUCKET: `missing-bucket-${randomUUID()}`,
      }),
      async () => {
        const moduleRef = await Test.createTestingModule({
          imports: [ConfigurationModule, StorageModule],
        }).compile();

        await expect(moduleRef.init()).rejects.toThrow(/does not exist/);
      },
    );
  });

  it('fails startup when a required bucket has a public-read policy', async () => {
    const publicBucket = `public-check-${randomUUID()}`;
    await client.makeBucket(publicBucket);
    await client.setBucketPolicy(
      publicBucket,
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${publicBucket}/*`],
          },
        ],
      }),
    );

    try {
      await withEnvironment(
        buildEnvironment({ MINIO_TEMP_BUCKET: publicBucket }),
        async () => {
          const moduleRef = await Test.createTestingModule({
            imports: [ConfigurationModule, StorageModule],
          }).compile();

          await expect(moduleRef.init()).rejects.toThrow(/must be private/);
        },
      );
    } finally {
      await client.removeBucket(publicBucket).catch(() => undefined);
    }
  });
});
