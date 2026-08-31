import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  DomainError,
  ErrorCode,
  toErrorResponseBody,
} from '@posts-media/domain';
import type { Response } from 'express';
import { MulterError } from 'multer';

import { RequestWithId } from '../middleware/request-id.middleware';

interface MulterErrorMapping {
  code: ErrorCode;
  status: number;
}

const MULTER_ERROR_MAP: Record<string, MulterErrorMapping> = {
  LIMIT_FILE_SIZE: {
    code: 'FILE_TRANSPORT_SIZE_EXCEEDED',
    status: HttpStatus.PAYLOAD_TOO_LARGE,
  },
  LIMIT_FILE_COUNT: {
    code: 'FILE_COUNT_EXCEEDED',
    status: HttpStatus.BAD_REQUEST,
  },
  LIMIT_UNEXPECTED_FILE: {
    code: 'UNEXPECTED_FILE_FIELD',
    status: HttpStatus.BAD_REQUEST,
  },
};

const MULTER_FALLBACK_MAPPING: MulterErrorMapping = {
  code: 'MULTIPART_BODY_INVALID',
  status: HttpStatus.BAD_REQUEST,
};

/**
 * Global exception filter (Part I §9/§22). Converts every thrown error
 * into the stable five-field API error shape, mapping `DomainError`s
 * directly and Multer's transport-limit errors into stable codes. Any
 * other exception is sanitized to a generic `INTERNAL_ERROR` — no
 * filesystem paths, credentials, or stack traces ever reach the response
 * body, though the full detail is still logged server-side.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const response = httpContext.getResponse<Response>();
    const request = httpContext.getRequest<Partial<RequestWithId>>();
    const requestId = request.requestId ?? 'unknown';

    const domainError = this.toDomainError(exception);

    this.logger.error(
      `[${requestId}] ${domainError.code}: ${domainError.message}`,
      domainError.httpStatus >= 500 && exception instanceof Error
        ? exception.stack
        : undefined,
    );

    if (domainError.code === 'IDEMPOTENCY_REQUEST_IN_PROGRESS') {
      const retryAfterSeconds = domainError.details?.['retryAfterSeconds'];
      if (typeof retryAfterSeconds === 'number') {
        response.setHeader('Retry-After', String(retryAfterSeconds));
      }
    }

    response
      .status(domainError.httpStatus)
      .json(toErrorResponseBody(domainError, requestId));
  }

  private toDomainError(exception: unknown): DomainError {
    if (exception instanceof DomainError) {
      return exception;
    }

    if (exception instanceof MulterError) {
      const mapping =
        MULTER_ERROR_MAP[exception.code] ?? MULTER_FALLBACK_MAPPING;
      return new DomainError(
        mapping.code,
        'The multipart upload request is invalid.',
        mapping.status,
      );
    }

    if (exception instanceof HttpException) {
      return new DomainError(
        'INTERNAL_ERROR',
        this.safeHttpExceptionMessage(exception),
        exception.getStatus(),
      );
    }

    return new DomainError(
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private safeHttpExceptionMessage(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return body;
    }
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
      if (Array.isArray(message)) {
        return message.join(' ');
      }
    }
    return exception.message;
  }
}
