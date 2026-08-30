import { DomainError } from './domain-error';
import { toErrorResponseBody } from './error-response';

describe('DomainError', () => {
  it('carries a stable machine-readable code, HTTP status, message, and optional details', () => {
    const error = new DomainError(
      'POST_NOT_FOUND',
      'The requested post does not exist.',
      404,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DomainError');
    expect(error.code).toBe('POST_NOT_FOUND');
    expect(error.httpStatus).toBe(404);
    expect(error.message).toBe('The requested post does not exist.');
    expect(error.details).toBeUndefined();
  });

  it('accepts structured details without leaking anything by default', () => {
    const error = new DomainError(
      'FILE_SIGNATURE_MISMATCH',
      'The uploaded content does not match the submitted media format.',
      422,
      {
        extension: 'mp4',
        declaredMimeType: 'video/mp4',
        detectedMimeType: 'image/jpeg',
      },
    );

    expect(error.details).toEqual({
      extension: 'mp4',
      declaredMimeType: 'video/mp4',
      detectedMimeType: 'image/jpeg',
    });
  });
});

describe('toErrorResponseBody', () => {
  it('serializes the stable API error shape with a requestId and no details when absent', () => {
    const error = new DomainError(
      'MEDIA_NOT_FOUND',
      'The requested media item does not exist.',
      404,
    );

    expect(toErrorResponseBody(error, 'req-123')).toEqual({
      statusCode: 404,
      code: 'MEDIA_NOT_FOUND',
      message: 'The requested media item does not exist.',
      requestId: 'req-123',
    });
  });

  it('includes details when the error carries them', () => {
    const error = new DomainError(
      'POST_MEDIA_VALIDATION_FAILED',
      'The post was not created because one or more files are invalid.',
      422,
      { rejectedCount: 1 },
    );

    expect(toErrorResponseBody(error, 'req-456')).toEqual({
      statusCode: 422,
      code: 'POST_MEDIA_VALIDATION_FAILED',
      message:
        'The post was not created because one or more files are invalid.',
      requestId: 'req-456',
      details: { rejectedCount: 1 },
    });
  });

  it('never serializes filesystem paths, credentials, or stack traces', () => {
    const error = new DomainError(
      'STORAGE_UNAVAILABLE',
      'Storage is unavailable.',
      503,
    );
    error.stack = '/home/user/secret/app.js:1:1';

    const body = toErrorResponseBody(error, 'req-789');

    expect(JSON.stringify(body)).not.toContain('/home/user/secret');
    expect(body).not.toHaveProperty('stack');
  });
});
