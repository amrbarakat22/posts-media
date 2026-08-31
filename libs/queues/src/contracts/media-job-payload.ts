import { MediaType } from '@posts-media/domain';
import type { DispatchReason } from '@prisma/client';

/**
 * The BullMQ job payload contract (Part I §6.3). Deliberately excludes
 * file buffers, base64 media, storage credentials, and presigned URLs —
 * the worker (Task 12+) re-reads everything it needs from PostgreSQL/MinIO
 * using these ids.
 */
export interface MediaJobPayloadV1 {
  readonly payloadVersion: 1;
  readonly dispatchId: string;
  readonly mediaId: string;
  readonly postId: string;
  readonly mediaType: MediaType;
  readonly generation: number;
  readonly processingProfile: 'balanced-v1';
  readonly reason: DispatchReason;
}
