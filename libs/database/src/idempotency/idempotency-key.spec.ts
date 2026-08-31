import { DomainError } from '@posts-media/domain';

import { validateIdempotencyKey } from './idempotency-key';

describe('validateIdempotencyKey', () => {
  it('accepts a valid 36-character UUID-style key', () => {
    expect(validateIdempotencyKey('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
  });

  it('accepts the minimum length of 8 characters', () => {
    expect(validateIdempotencyKey('12345678')).toBe('12345678');
  });

  it('accepts the maximum length of 128 characters', () => {
    const key = 'a'.repeat(128);
    expect(validateIdempotencyKey(key)).toBe(key);
  });

  it('throws IDEMPOTENCY_KEY_REQUIRED when the header is missing', () => {
    expect(() => validateIdempotencyKey(undefined)).toThrow(DomainError);
    try {
      validateIdempotencyKey(undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      expect((error as DomainError).httpStatus).toBe(400);
    }
  });

  it('throws IDEMPOTENCY_KEY_REQUIRED for an empty string', () => {
    expect(() => validateIdempotencyKey('')).toThrow(DomainError);
  });

  it.each([
    ['too short', '1234567'],
    ['too long', 'a'.repeat(129)],
    ['contains a space', 'abcdefg h'],
    ['contains a newline', 'abcdefg\nh'],
    ['contains a tab', 'abcdefg\th'],
  ])('throws IDEMPOTENCY_KEY_INVALID when the key is %s', (_label, key) => {
    try {
      validateIdempotencyKey(key);
      throw new Error('expected validateIdempotencyKey to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('IDEMPOTENCY_KEY_INVALID');
      expect((error as DomainError).httpStatus).toBe(400);
    }
  });
});
