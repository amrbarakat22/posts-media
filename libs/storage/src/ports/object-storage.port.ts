export interface ObjectRef {
  bucket: string;
  objectKey: string;
}

export interface StoredObject extends ObjectRef {
  etag?: string;
  sizeBytes: bigint;
}

/**
 * S3-compatible object storage abstraction (Part I §6.2). Implementations
 * must stream/file-copy rather than buffer whole objects in memory, since
 * originals can be up to 250 MiB video files.
 */
export interface ObjectStoragePort {
  putFile(
    ref: ObjectRef,
    localPath: string,
    metadata?: Record<string, string>,
  ): Promise<StoredObject>;
  copy(source: ObjectRef, destination: ObjectRef): Promise<StoredObject>;
  stat(ref: ObjectRef): Promise<StoredObject>;
  downloadToFile(ref: ObjectRef, destinationPath: string): Promise<void>;
  remove(ref: ObjectRef): Promise<void>;
  removeMany(refs: ObjectRef[]): Promise<void>;
  exists(ref: ObjectRef): Promise<boolean>;
  presignedGet(ref: ObjectRef, expiresInSeconds: number): Promise<string>;
}

export const OBJECT_STORAGE_PORT = Symbol('OBJECT_STORAGE_PORT');
