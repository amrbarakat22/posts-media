import { canonicalizeDeclaredMimeType } from './mime-policy';

describe('declared MIME policy', () => {
  it.each([
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['image/x-png', 'image/png'],
    ['audio/mp3', 'audio/mpeg'],
    ['audio/x-wav', 'audio/wav'],
    ['audio/x-m4a', 'audio/mp4'],
    ['audio/x-aac', 'audio/aac'],
    ['audio/x-flac', 'audio/flac'],
    ['application/ogg', 'audio/ogg'],
    ['video/quicktime', 'video/quicktime'],
    ['video/matroska', 'video/x-matroska'],
    ['application/octet-stream', 'application/octet-stream'],
    [' IMAGE/JPEG ; charset=binary ', 'image/jpeg'],
  ])('canonicalizes %s to %s', (declared, canonical) => {
    expect(canonicalizeDeclaredMimeType(declared)).toBe(canonical);
  });

  it.each(['', 'text/plain', 'application/pdf', 'image/gif'])(
    'rejects unsupported MIME %j',
    (mimeType) => {
      expect(() => canonicalizeDeclaredMimeType(mimeType)).toThrow(
        expect.objectContaining({ code: 'UNSUPPORTED_MIME_TYPE' }),
      );
    },
  );
});
