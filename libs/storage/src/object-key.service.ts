import { ObjectRef } from './ports/object-storage.port';

export interface StorageBuckets {
  originals: string;
  processed: string;
  temporary: string;
}

/**
 * Derives object keys from controlled identifiers only (Part I §2.1).
 * No method accepts the user-supplied original filename — paths are built
 * exclusively from database-generated IDs, the detected canonical
 * extension, the fixed processing profile name, and fixed per-variant
 * filenames chosen by the processors, never from untrusted input.
 */
export class ObjectKeyService {
  public constructor(private readonly buckets: StorageBuckets) {}

  public originalKey(
    postId: string,
    mediaId: string,
    canonicalExtension: string,
  ): ObjectRef {
    return {
      bucket: this.buckets.originals,
      objectKey: `posts/${postId}/${mediaId}/original.${canonicalExtension}`,
    };
  }

  public processedKey(
    postId: string,
    mediaId: string,
    processingProfile: string,
    canonicalFilename: string,
  ): ObjectRef {
    return {
      bucket: this.buckets.processed,
      objectKey: `posts/${postId}/${mediaId}/${processingProfile}/${canonicalFilename}`,
    };
  }

  public processedAttemptKey(
    postId: string,
    mediaId: string,
    processingProfile: string,
    generation: number,
    attemptId: string,
    canonicalFilename: string,
  ): ObjectRef {
    return {
      bucket: this.buckets.processed,
      objectKey: `posts/${postId}/${mediaId}/${processingProfile}/generations/${generation}/attempts/${attemptId}/${canonicalFilename}`,
    };
  }

  public uploadStagingKey(requestId: string, fileId: string): ObjectRef {
    return {
      bucket: this.buckets.temporary,
      objectKey: `uploads/${requestId}/${fileId}`,
    };
  }

  public processingTempKey(
    mediaId: string,
    generation: number,
    attemptId: string,
    canonicalVariantFilename: string,
  ): ObjectRef {
    return {
      bucket: this.buckets.temporary,
      objectKey: `processing/${mediaId}/${generation}/${attemptId}/${canonicalVariantFilename}`,
    };
  }
}
