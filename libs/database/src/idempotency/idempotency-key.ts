import { DomainError } from '@posts-media/domain';

/**
 * `Idempotency-Key` syntax (Part I §2.11): 8-128 printable, non-whitespace
 * ASCII characters. The static UI generates `crypto.randomUUID()` (36
 * chars), which satisfies this easily.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{8,128}$/;

/**
 * Validates an `Idempotency-Key` header value, distinguishing a missing
 * header (`IDEMPOTENCY_KEY_REQUIRED`) from a present-but-malformed one
 * (`IDEMPOTENCY_KEY_INVALID`).
 */
export const validateIdempotencyKey = (key: string | undefined): string => {
  if (key === undefined || key.length === 0) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'An Idempotency-Key header is required for this request.',
      400,
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new DomainError(
      'IDEMPOTENCY_KEY_INVALID',
      'The Idempotency-Key header must be 8-128 printable, non-whitespace characters.',
      400,
    );
  }
  return key;
};
