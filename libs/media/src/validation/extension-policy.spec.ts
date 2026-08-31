import { MediaType } from '@posts-media/domain';

import {
  normalizeOriginalFilename,
  resolveExtensionPolicy,
} from './extension-policy';

describe('extension policy', () => {
  it.each([
    ['FILE.JPG', 'jpg', 'jpeg', MediaType.IMAGE, 'image/jpeg'],
    ['FILE.JPEG', 'jpeg', 'jpeg', MediaType.IMAGE, 'image/jpeg'],
    ['FILE.PNG', 'png', 'png', MediaType.IMAGE, 'image/png'],
    ['FILE.WEBP', 'webp', 'webp', MediaType.IMAGE, 'image/webp'],
    ['FILE.MP3', 'mp3', 'mp3', MediaType.AUDIO, 'audio/mpeg'],
    ['FILE.WAV', 'wav', 'wav', MediaType.AUDIO, 'audio/wav'],
    ['FILE.M4A', 'm4a', 'm4a', MediaType.AUDIO, 'audio/mp4'],
    ['FILE.AAC', 'aac', 'aac', MediaType.AUDIO, 'audio/aac'],
    ['FILE.FLAC', 'flac', 'flac', MediaType.AUDIO, 'audio/flac'],
    ['FILE.OGG', 'ogg', 'ogg', MediaType.AUDIO, 'audio/ogg'],
    ['FILE.OGA', 'oga', 'ogg', MediaType.AUDIO, 'audio/ogg'],
    ['FILE.MP4', 'mp4', 'mp4', MediaType.VIDEO, 'video/mp4'],
    ['FILE.MOV', 'mov', 'mov', MediaType.VIDEO, 'video/quicktime'],
    ['FILE.WEBM', 'webm', 'webm', MediaType.VIDEO, 'video/webm'],
    ['FILE.MKV', 'mkv', 'mkv', MediaType.VIDEO, 'video/x-matroska'],
  ])(
    'accepts %s case-insensitively',
    (filename, extension, format, mediaType, mimeType) => {
      expect(resolveExtensionPolicy(filename)).toMatchObject({
        extension,
        format,
        mediaType,
        detectedMimeType: mimeType,
      });
    },
  );

  it('normalizes a display filename without treating it as a path', () => {
    expect(normalizeOriginalFilename('  family\u0000  photo.jpg  ')).toBe(
      'family photo.jpg',
    );
    expect(normalizeOriginalFilename('../../private/secret.jpg')).toBe(
      'secret.jpg',
    );
    expect(normalizeOriginalFilename('C:\\private\\secret.jpg')).toBe(
      'secret.jpg',
    );
  });

  it.each([
    ['', 'INVALID_ORIGINAL_FILENAME'],
    ['   ', 'INVALID_ORIGINAL_FILENAME'],
    ['.', 'MISSING_EXTENSION'],
    ['README', 'MISSING_EXTENSION'],
    ['photo.exe', 'UNSUPPORTED_EXTENSION'],
  ])('rejects %j with %s', (filename, code) => {
    expect(() => resolveExtensionPolicy(filename)).toThrow(
      expect.objectContaining({ code }),
    );
  });
});
