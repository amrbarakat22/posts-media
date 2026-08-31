import { resolveExtensionPolicy } from './extension-policy';
import {
  canonicalizeDeclaredMimeType,
  isDeclaredMimeCompatible,
} from './mime-policy';

describe('declared MIME policy', () => {
  it.each([
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['image/x-png', 'image/png'],
    ['image/png', 'image/png'],
    ['image/webp', 'image/webp'],
    ['audio/mpeg', 'audio/mpeg'],
    ['audio/mp3', 'audio/mpeg'],
    ['audio/x-mp3', 'audio/mpeg'],
    ['audio/wav', 'audio/wav'],
    ['audio/wave', 'audio/wav'],
    ['audio/x-wav', 'audio/wav'],
    ['audio/mp4', 'audio/mp4'],
    ['audio/m4a', 'audio/mp4'],
    ['audio/x-m4a', 'audio/mp4'],
    ['audio/aac', 'audio/aac'],
    ['audio/aacp', 'audio/aac'],
    ['audio/x-aac', 'audio/aac'],
    ['audio/flac', 'audio/flac'],
    ['audio/x-flac', 'audio/flac'],
    ['audio/ogg', 'audio/ogg'],
    ['application/ogg', 'audio/ogg'],
    ['video/mp4', 'video/mp4'],
    ['video/quicktime', 'video/quicktime'],
    ['video/webm', 'video/webm'],
    ['video/matroska', 'video/x-matroska'],
    ['video/x-matroska', 'video/x-matroska'],
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

  it.each([
    ['file.jpg', 'image/jpeg'],
    ['file.jpeg', 'image/pjpeg'],
    ['file.png', 'image/x-png'],
    ['file.webp', 'image/webp'],
    ['file.mp3', 'audio/x-mp3'],
    ['file.wav', 'audio/wave'],
    ['file.m4a', 'audio/x-m4a'],
    ['file.aac', 'audio/aacp'],
    ['file.flac', 'audio/x-flac'],
    ['file.ogg', 'application/ogg'],
    ['file.oga', 'audio/ogg'],
    ['file.mp4', 'video/mp4'],
    ['file.mov', 'video/quicktime'],
    ['file.webm', 'video/webm'],
    ['file.mkv', 'video/matroska'],
  ])('accepts declared MIME alias %s for %s', (filename, declaredMimeType) => {
    const policy = resolveExtensionPolicy(filename);
    const canonical = canonicalizeDeclaredMimeType(declaredMimeType);
    expect(isDeclaredMimeCompatible(policy, canonical)).toBe(true);
  });

  it.each([
    ['file.jpg', 'image/png'],
    ['file.png', 'image/webp'],
    ['file.webp', 'image/jpeg'],
    ['file.mp3', 'audio/wav'],
    ['file.wav', 'audio/mp4'],
    ['file.m4a', 'audio/aac'],
    ['file.aac', 'audio/flac'],
    ['file.flac', 'audio/ogg'],
    ['file.ogg', 'audio/mpeg'],
    ['file.oga', 'audio/mpeg'],
    ['file.mp4', 'video/quicktime'],
    ['file.mov', 'video/webm'],
    ['file.webm', 'video/x-matroska'],
    ['file.mkv', 'video/mp4'],
    ['file.jpg', 'audio/mpeg'],
    ['file.jpg', 'video/mp4'],
    ['file.mp3', 'image/jpeg'],
    ['file.mp3', 'video/mp4'],
    ['file.mp4', 'image/jpeg'],
    ['file.mp4', 'audio/mpeg'],
  ])('rejects incompatible pair %s + %s', (filename, declaredMimeType) => {
    expect(
      isDeclaredMimeCompatible(
        resolveExtensionPolicy(filename),
        canonicalizeDeclaredMimeType(declaredMimeType),
      ),
    ).toBe(false);
  });

  it.each([
    'jpg',
    'jpeg',
    'png',
    'webp',
    'mp3',
    'wav',
    'm4a',
    'aac',
    'flac',
    'ogg',
    'oga',
    'mp4',
    'mov',
    'webm',
    'mkv',
  ])(
    'permits generic MIME for .%s pending signature/parser proof',
    (extension) => {
      expect(
        isDeclaredMimeCompatible(
          resolveExtensionPolicy(`file.${extension}`),
          canonicalizeDeclaredMimeType('application/octet-stream'),
        ),
      ).toBe(true);
    },
  );
});
