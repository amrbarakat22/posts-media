import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import {
  ConfigurationModule,
  EnvironmentConfigurationService,
} from '@posts-media/configuration';
import { Client } from 'minio';

import { MinioObjectStorageAdapter } from './minio/minio-object-storage.adapter';
import { ObjectKeyService } from './object-key.service';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port';

export const MINIO_CLIENT = Symbol('MINIO_CLIENT');

const isNoSuchBucketPolicyError = (error: unknown): boolean =>
  (error as { code?: string } | undefined)?.code === 'NoSuchBucketPolicy';

interface PolicyStatement {
  Effect?: string;
  Principal?: unknown;
}

const grantsPublicAccess = (policyJson: string): boolean => {
  const policy = JSON.parse(policyJson) as { Statement?: PolicyStatement[] };
  return (policy.Statement ?? []).some((statement) => {
    if (statement.Effect !== 'Allow') {
      return false;
    }
    const principal = statement.Principal;
    if (principal === '*') {
      return true;
    }
    if (
      typeof principal === 'object' &&
      principal !== null &&
      'AWS' in principal
    ) {
      const aws = (principal as { AWS: unknown }).AWS;
      return aws === '*' || (Array.isArray(aws) && aws.includes('*'));
    }
    return false;
  });
};

@Global()
@Module({
  imports: [ConfigurationModule],
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new Client({
          endPoint: configuration.values.storage.endpoint,
          port: configuration.values.storage.port,
          useSSL: configuration.values.storage.useSsl,
          accessKey: configuration.values.storage.accessKey,
          secretKey: configuration.values.storage.secretKey,
        }),
    },
    {
      provide: OBJECT_STORAGE_PORT,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new MinioObjectStorageAdapter({
          endpoint: configuration.values.storage.endpoint,
          port: configuration.values.storage.port,
          useSsl: configuration.values.storage.useSsl,
          accessKey: configuration.values.storage.accessKey,
          secretKey: configuration.values.storage.secretKey,
        }),
    },
    {
      provide: ObjectKeyService,
      inject: [EnvironmentConfigurationService],
      useFactory: (configuration: EnvironmentConfigurationService) =>
        new ObjectKeyService({
          originals: configuration.values.storage.originalsBucket,
          processed: configuration.values.storage.processedBucket,
          temporary: configuration.values.storage.temporaryBucket,
        }),
    },
  ],
  exports: [OBJECT_STORAGE_PORT, ObjectKeyService],
})
export class StorageModule implements OnModuleInit {
  public constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    private readonly configuration: EnvironmentConfigurationService,
  ) {}

  /**
   * Verifies, on startup, that every required bucket exists and carries no
   * public-read policy (Part I §5 Task 5 Step 5). A missing bucket or a
   * public policy fails application startup rather than allowing silent
   * exposure of private originals/processed media.
   */
  public async onModuleInit(): Promise<void> {
    const { originalsBucket, processedBucket, temporaryBucket } =
      this.configuration.values.storage;

    for (const bucket of [originalsBucket, processedBucket, temporaryBucket]) {
      await this.assertBucketIsPrivate(bucket);
    }
  }

  private async assertBucketIsPrivate(bucket: string): Promise<void> {
    const exists = await this.client.bucketExists(bucket);
    if (!exists) {
      throw new Error(`Required storage bucket "${bucket}" does not exist`);
    }

    try {
      const policy = await this.client.getBucketPolicy(bucket);
      if (policy.length > 0 && grantsPublicAccess(policy)) {
        throw new Error(
          `Storage bucket "${bucket}" must be private but has a public-read policy`,
        );
      }
    } catch (error) {
      if (isNoSuchBucketPolicyError(error)) {
        return;
      }
      throw error;
    }
  }
}
