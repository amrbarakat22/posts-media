import { MediaType } from '@posts-media/domain';

import {
  normalizeOriginalFilename,
  resolveExtensionPolicy,
} from './extension-policy';

describe('extension policy', () => {
  it.each([
    ['photo.jpg', 'jpg', MediaType.IMAGE],
    ['photo.JPEG', 'jpeg', MediaType.IMAGE],
    ['clip.PNG', 'png', MediaType.IMAGE],
    ['sound.OGA', 'oga', MediaType.AUDIO],
    ['movie.MKV', 'mkv', MediaType.VIDEO],
  ])('accepts %s case-insensitively', (filename, extension, mediaType) => {
    expect(resolveExtensionPolicy(filename)).toMatchObject({
      extension,
      mediaType,
    });
  });

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
