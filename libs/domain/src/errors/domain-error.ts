import { ErrorCode } from './error-code';

export type DomainErrorDetails = Record<string, unknown>;

/**
 * The single error type thrown by application use cases for every
 * client-facing and processing failure. Carries a stable machine-readable
 * `code` (Part I §9), the HTTP status the API should respond with, and
 * optional sanitized `details` — never filesystem paths, credentials, or
 * raw stack traces.
 */
export class DomainError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;
  public readonly details?: DomainErrorDetails;

  public constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    details?: DomainErrorDetails,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    Object.setPrototypeOf(this, DomainError.prototype);
  }
}
