import { DomainError } from '@posts-media/domain';

import {
  domainErrorToOutcome,
  outcomeToDomainError,
} from './idempotent-domain-error';

describe('domainErrorToOutcome / outcomeToDomainError', () => {
  it('round-trips a DomainError without details', () => {
    const error = new DomainError(
      'POST_NOT_FOUND',
      'The requested post does not exist.',
      404,
    );

    const outcome = domainErrorToOutcome(error);
    expect(outcome.responseStatus).toBe(404);
    expect(outcome.responseBody).toEqual({
      code: 'POST_NOT_FOUND',
      message: 'The requested post does not exist.',
    });

    const restored = outcomeToDomainError(outcome);
    expect(restored.code).toBe('POST_NOT_FOUND');
    expect(restored.message).toBe('The requested post does not exist.');
    expect(restored.httpStatus).toBe(404);
    expect(restored.details).toBeUndefined();
  });

  it('round-trips a DomainError with details', () => {
    const error = new DomainError(
      'POST_MEDIA_VALIDATION_FAILED',
      'The post was not created because one or more files are invalid.',
      422,
      { rejected: [{ fileIndex: 1, code: 'FILE_SIGNATURE_MISMATCH' }] },
    );

    const outcome = domainErrorToOutcome(error);
    const restored = outcomeToDomainError(outcome);

    expect(restored.code).toBe('POST_MEDIA_VALIDATION_FAILED');
    expect(restored.httpStatus).toBe(422);
    expect(restored.details).toEqual({
      rejected: [{ fileIndex: 1, code: 'FILE_SIGNATURE_MISMATCH' }],
    });
  });

  it('never embeds a requestId in the stored outcome body', () => {
    const error = new DomainError('POST_NOT_FOUND', 'x', 404);
    const outcome = domainErrorToOutcome(error);
    expect(outcome.responseBody).not.toHaveProperty('requestId');
  });

  it('falls back to INTERNAL_ERROR for a malformed stored body', () => {
    const restored = outcomeToDomainError({
      responseStatus: 500,
      responseBody: {},
    });
    expect(restored.code).toBe('INTERNAL_ERROR');
    expect(restored.httpStatus).toBe(500);
  });
});
