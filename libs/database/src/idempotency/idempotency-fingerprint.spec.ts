import {
  computeIdempotencyFingerprint,
  type FingerprintInput,
} from './idempotency-fingerprint';

const baseInput: FingerprintInput = {
  operation: 'CREATE_POST',
  routeParams: {},
  body: { title: 'Hello', content: 'World' },
  files: [
    {
      originalFilename: 'photo.jpg',
      declaredMimeType: 'image/jpeg',
      sizeBytes: '1024',
      checksumSha256: 'a'.repeat(64),
    },
  ],
};

describe('computeIdempotencyFingerprint', () => {
  it('is deterministic for the same logical input', () => {
    expect(computeIdempotencyFingerprint(baseInput)).toBe(
      computeIdempotencyFingerprint(baseInput),
    );
  });

  it('is stable regardless of body key order', () => {
    const reordered: FingerprintInput = {
      ...baseInput,
      body: { content: 'World', title: 'Hello' },
    };
    expect(computeIdempotencyFingerprint(baseInput)).toBe(
      computeIdempotencyFingerprint(reordered),
    );
  });

  it('changes when the body content changes', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      body: { title: 'Different', content: 'World' },
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('changes when the operation changes', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      operation: 'ADD_POST_MEDIA',
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('changes when route params change', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      routeParams: { postId: '123' },
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('changes when file order changes, even with the same files', () => {
    const fileA = baseInput.files[0]!;
    const fileB = {
      originalFilename: 'clip.mp4',
      declaredMimeType: 'video/mp4',
      sizeBytes: '2048',
      checksumSha256: 'b'.repeat(64),
    };

    const forward = computeIdempotencyFingerprint({
      ...baseInput,
      files: [fileA, fileB],
    });
    const reversed = computeIdempotencyFingerprint({
      ...baseInput,
      files: [fileB, fileA],
    });

    expect(forward).not.toBe(reversed);
  });

  it('changes when a file checksum changes', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      files: [{ ...baseInput.files[0]!, checksumSha256: 'c'.repeat(64) }],
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('changes when a file size changes', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      files: [{ ...baseInput.files[0]!, sizeBytes: '2048' }],
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('changes when a declared MIME type changes', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      files: [{ ...baseInput.files[0]!, declaredMimeType: 'image/png' }],
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('changes when a normalized filename changes', () => {
    const changed: FingerprintInput = {
      ...baseInput,
      files: [{ ...baseInput.files[0]!, originalFilename: 'other.jpg' }],
    };
    expect(computeIdempotencyFingerprint(baseInput)).not.toBe(
      computeIdempotencyFingerprint(changed),
    );
  });

  it('produces the same fingerprint for zero files as an explicit empty array', () => {
    const noFiles: FingerprintInput = { ...baseInput, files: [] };
    expect(computeIdempotencyFingerprint(noFiles)).toBe(
      computeIdempotencyFingerprint({ ...baseInput, files: [] }),
    );
  });

  it('returns a 64-character lowercase hex SHA-256 digest', () => {
    expect(computeIdempotencyFingerprint(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});
