import { DomainError, ERROR_CODES, type ErrorCode } from '@posts-media/domain';
import type { Prisma } from '@prisma/client';

import type { IdempotentOutcome } from './idempotency.service';

/**
 * Converts a deterministic, replayable rejection (Part I §11: "Finalized
 * deterministic validation responses are replayable") into the outcome
 * shape `IdempotencyService.finalize` stores. The stored body deliberately
 * omits `requestId` — replays regenerate it fresh via the normal
 * `ApiExceptionFilter` path so every response (first attempt or replay)
 * carries the requestId of the request that actually received it.
 */
export const domainErrorToOutcome = (
  error: DomainError,
): IdempotentOutcome => ({
  responseStatus: error.httpStatus,
  responseBody: {
    code: error.code,
    message: error.message,
    ...(error.details !== undefined
      ? { details: error.details as Prisma.InputJsonValue }
      : {}),
  },
});

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' &&
  (ERROR_CODES as readonly string[]).includes(value);

/**
 * Reconstructs a throwable `DomainError` from a replayed error outcome, so
 * a repeated request for a previously-rejected idempotency key flows
 * through the same global exception filter as a fresh rejection would.
 */
export const outcomeToDomainError = (
  outcome: IdempotentOutcome,
): DomainError => {
  const body = outcome.responseBody as {
    code?: unknown;
    message?: unknown;
    details?: Record<string, unknown>;
  } | null;
  const code = isErrorCode(body?.code) ? body.code : 'INTERNAL_ERROR';
  const message =
    typeof body?.message === 'string'
      ? body.message
      : 'The original request failed.';
  return new DomainError(code, message, outcome.responseStatus, body?.details);
};
