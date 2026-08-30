import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { Client, CopyDestinationOptions, CopySourceOptions } from 'minio';

import {
  ObjectRef,
  ObjectStoragePort,
  StoredObject,
} from '../ports/object-storage.port';

export interface MinioConnectionOptions {
  endpoint: string;
  port: number;
  useSsl: boolean;
  accessKey: string;
  secretKey: string;
}

const isMissingObjectError = (error: unknown): boolean => {
  const code = (error as { code?: string } | undefined)?.code;
  return code === 'NotFound' || code === 'NoSuchKey';
};

/**
 * `ObjectStoragePort` implementation backed by the `minio` S3-compatible
 * client. Uploads/downloads always go through the client's file-based
 * `fPutObject`/`fGetObject` methods so large originals (up to 250 MiB
 * video) are streamed rather than buffered in process memory.
 */
export class MinioObjectStorageAdapter implements ObjectStoragePort {
  private readonly client: Client;

  public constructor(options: MinioConnectionOptions) {
    this.client = new Client({
      endPoint: options.endpoint,
      port: options.port,
      useSSL: options.useSsl,
      accessKey: options.accessKey,
      secretKey: options.secretKey,
    });
  }

  public async putFile(
    ref: ObjectRef,
    localPath: string,
    metadata?: Record<string, string>,
  ): Promise<StoredObject> {
    await this.client.fPutObject(
      ref.bucket,
      ref.objectKey,
      localPath,
      metadata,
    );
    return this.stat(ref);
  }

  public async copy(
    source: ObjectRef,
    destination: ObjectRef,
  ): Promise<StoredObject> {
    await this.client.copyObject(
      new CopySourceOptions({
        Bucket: source.bucket,
        Object: source.objectKey,
      }),
      new CopyDestinationOptions({
        Bucket: destination.bucket,
        Object: destination.objectKey,
      }),
    );
    return this.stat(destination);
  }

  public async stat(ref: ObjectRef): Promise<StoredObject> {
    const stat = await this.client.statObject(ref.bucket, ref.objectKey);
    return {
      bucket: ref.bucket,
      objectKey: ref.objectKey,
      etag: stat.etag,
      sizeBytes: BigInt(stat.size),
    };
  }

  public async downloadToFile(
    ref: ObjectRef,
    destinationPath: string,
  ): Promise<void> {
    // Piped directly (source stream -> local write stream) rather than
    // through the client's own temp-file-then-rename helper, so the
    // object's bytes are streamed straight to disk without ever being
    // buffered whole in process memory.
    const objectStream = await this.client.getObject(ref.bucket, ref.objectKey);
    await pipeline(objectStream, createWriteStream(destinationPath));
  }

  public async remove(ref: ObjectRef): Promise<void> {
    await this.client.removeObject(ref.bucket, ref.objectKey);
  }

  public async removeMany(refs: ObjectRef[]): Promise<void> {
    const byBucket = new Map<string, string[]>();
    for (const ref of refs) {
      const objectKeys = byBucket.get(ref.bucket) ?? [];
      objectKeys.push(ref.objectKey);
      byBucket.set(ref.bucket, objectKeys);
    }

    for (const [bucket, objectKeys] of byBucket) {
      await this.client.removeObjects(bucket, objectKeys);
    }
  }

  public async exists(ref: ObjectRef): Promise<boolean> {
    try {
      await this.client.statObject(ref.bucket, ref.objectKey);
      return true;
    } catch (error) {
      if (isMissingObjectError(error)) {
        return false;
      }
      throw error;
    }
  }

  public async presignedGet(
    ref: ObjectRef,
    expiresInSeconds: number,
  ): Promise<string> {
    return this.client.presignedGetObject(
      ref.bucket,
      ref.objectKey,
      expiresInSeconds,
    );
  }
}
