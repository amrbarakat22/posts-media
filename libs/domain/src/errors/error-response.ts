import { DomainError } from './domain-error';
import { ErrorCode } from './error-code';

/**
 * The stable top-level API error shape (Part I §9). Never includes a
 * `stack` field or any field beyond these five.
 */
export interface ApiErrorResponseBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}

export function toErrorResponseBody(
  error: DomainError,
  requestId: string,
): ApiErrorResponseBody {
  return {
    statusCode: error.httpStatus,
    code: error.code,
    message: error.message,
    requestId,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}
