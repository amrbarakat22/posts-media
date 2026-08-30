import type { NextFunction, Request, Response } from 'express';

import { RequestIdMiddleware } from './request-id.middleware';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const buildRequest = (headerValue: string | undefined): Request =>
  ({
    header: (name: string) =>
      name.toLowerCase() === 'x-request-id' ? headerValue : undefined,
  }) as unknown as Request;

const buildResponse = (): {
  response: Response;
  headers: Record<string, string>;
} => {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;
  return { response, headers };
};

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();

  it('generates a UUID request id when none is supplied', () => {
    const request = buildRequest(undefined);
    const { response, headers } = buildResponse();
    const next = jest.fn<void, []>();

    middleware.use(request, response, next as unknown as NextFunction);

    const requestId = (request as unknown as { requestId: string }).requestId;
    expect(requestId).toMatch(UUID_PATTERN);
    expect(headers['X-Request-Id']).toBe(requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves a safe incoming request id', () => {
    const request = buildRequest('client-request-123');
    const { response, headers } = buildResponse();

    middleware.use(request, response, jest.fn() as unknown as NextFunction);

    expect((request as unknown as { requestId: string }).requestId).toBe(
      'client-request-123',
    );
    expect(headers['X-Request-Id']).toBe('client-request-123');
  });

  it.each([
    ['too long', 'a'.repeat(101)],
    ['path traversal', '../../etc/passwd'],
    ['script injection', '<script>alert(1)</script>'],
    ['contains whitespace', 'has spaces'],
    ['empty string', ''],
  ])('replaces an unsafe incoming request id (%s)', (_label, unsafe) => {
    const request = buildRequest(unsafe);
    const { response } = buildResponse();

    middleware.use(request, response, jest.fn() as unknown as NextFunction);

    const requestId = (request as unknown as { requestId: string }).requestId;
    expect(requestId).not.toBe(unsafe);
    expect(requestId).toMatch(UUID_PATTERN);
  });
});
