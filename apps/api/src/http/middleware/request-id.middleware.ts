import { randomUUID } from 'node:crypto';

import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Conservative allowlist: letters, digits, and hyphens, 1-100 characters. */
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

/**
 * Assigns every request a stable `requestId` for correlation across logs,
 * errors, and responses (Part I §22). An incoming `X-Request-Id` header is
 * reused only when it passes a strict length/character policy; anything
 * else (oversized, containing unsafe characters, or absent) is replaced
 * with a freshly generated UUID rather than trusted verbatim.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  public use = (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming !== undefined && SAFE_REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();

    (req as RequestWithId).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
