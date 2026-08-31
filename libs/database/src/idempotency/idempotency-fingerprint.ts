import { createHash } from 'node:crypto';

import type { IdempotencyOperation } from '@prisma/client';

// `fast-json-stable-stringify` uses `export =`; without `esModuleInterop`
// this is the correct interop form (see tsconfig.json).
// eslint-disable-next-line @typescript-eslint/no-require-imports
import stableStringify = require('fast-json-stable-stringify');

/**
 * One uploaded file's contribution to the fingerprint (Part I §2.11).
 * Deliberately excludes generated ids, temp paths, and MinIO keys — only
 * content-derived and client-declared fields participate.
 */
export interface FingerprintFile {
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly sizeBytes: string;
  readonly checksumSha256: string;
}

/**
 * Everything the canonical fingerprint is computed from. `routeParams` and
 * `body` must already be normalized/stripped of anything non-deterministic
 * by the caller (no timestamps, no generated ids).
 */
export interface FingerprintInput {
  readonly operation: IdempotencyOperation;
  readonly routeParams: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly files: readonly FingerprintFile[];
}

/**
 * Computes the stable SHA-256 fingerprint used to detect whether a repeated
 * `Idempotency-Key` carries the same logical request (safe to replay) or a
 * different one (`IDEMPOTENCY_KEY_REUSED`). Uses deterministic JSON
 * serialization (`fast-json-stable-stringify`) so key order never affects
 * the digest, and preserves file array order since upload order is
 * semantically meaningful (Part I §2.11).
 */
export const computeIdempotencyFingerprint = (
  input: FingerprintInput,
): string => {
  const canonical = {
    operation: input.operation,
    routeParams: input.routeParams,
    body: input.body,
    files: input.files.map((file) => ({
      originalFilename: file.originalFilename,
      declaredMimeType: file.declaredMimeType,
      sizeBytes: file.sizeBytes,
      checksumSha256: file.checksumSha256,
    })),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
};
