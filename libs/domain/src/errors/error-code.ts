/**
 * The complete set of stable, machine-readable error codes defined by
 * Part I §9. Every mutation/read use case throws a `DomainError` carrying
 * one of these codes; the codes are also reused as `Media.lastErrorCode`
 * and `ProcessingAttempt.errorCode` values for processing failures that
 * never reach an HTTP response directly.
 *
 * `INTERNAL_ERROR` is not one of the plan's named codes — it is the global
 * exception filter's (Task 6) fallback for exceptions that are neither a
 * `DomainError` nor a recognized Multer limit error: a genuinely
 * unexpected failure, not a business-rule rejection.
 */
export const ERROR_CODES = [
  'INTERNAL_ERROR',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_REQUEST_IN_PROGRESS',
  'POST_NOT_FOUND',
  'POST_SOFT_DELETED',
  'POST_MEDIA_VALIDATION_FAILED',
  'MEDIA_NOT_FOUND',
  'MEDIA_RETRY_NOT_ALLOWED',
  'MULTIPART_BODY_INVALID',
  'UNEXPECTED_FILE_FIELD',
  'FILE_COUNT_EXCEEDED',
  'TOTAL_UPLOAD_SIZE_EXCEEDED',
  'FILE_TRANSPORT_SIZE_EXCEEDED',
  'EMPTY_FILE',
  'INVALID_ORIGINAL_FILENAME',
  'MISSING_EXTENSION',
  'UNSUPPORTED_EXTENSION',
  'UNSUPPORTED_MIME_TYPE',
  'UNKNOWN_FILE_SIGNATURE',
  'FILE_SIGNATURE_MISMATCH',
  'CORRUPTED_FILE',
  'ANIMATED_IMAGE_NOT_SUPPORTED',
  'IMAGE_PIXEL_LIMIT_EXCEEDED',
  'MEDIA_STREAM_NOT_FOUND',
  'UNSUPPORTED_AUDIO_CODEC',
  'UNSUPPORTED_VIDEO_CODEC',
  'MEDIA_VALIDATION_TIMEOUT',
  'FILE_SIZE_EXCEEDED',
  'TEMPORARY_FILE_WRITE_FAILED',
  'CHECKSUM_CALCULATION_FAILED',
  'STORAGE_UNAVAILABLE',
  'ORIGINAL_PROMOTION_FAILED',
  'QUEUE_DISPATCH_DEAD',
  'PROCESSING_TIMEOUT',
  'PROCESSING_OUTPUT_INVALID',
  'PROCESSING_CHECKSUM_MISMATCH',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
