import { DomainError, MediaType } from '@posts-media/domain';

export interface ExtensionPolicy {
  readonly extension: string;
  readonly format: string;
  readonly mediaType: MediaType;
  readonly detectedMimeType: string;
  readonly declaredMimeTypes: readonly string[];
}

const policies: Readonly<Record<string, ExtensionPolicy>> = {
  jpg: image('jpg', 'jpeg', 'image/jpeg'),
  jpeg: image('jpeg', 'jpeg', 'image/jpeg'),
  png: image('png', 'png', 'image/png'),
  webp: image('webp', 'webp', 'image/webp'),
  mp3: audio('mp3', 'mp3', 'audio/mpeg'),
  wav: audio('wav', 'wav', 'audio/wav'),
  m4a: audio('m4a', 'm4a', 'audio/mp4'),
  aac: audio('aac', 'aac', 'audio/aac'),
  flac: audio('flac', 'flac', 'audio/flac'),
  ogg: audio('ogg', 'ogg', 'audio/ogg'),
  oga: audio('oga', 'ogg', 'audio/ogg'),
  mp4: video('mp4', 'mp4', 'video/mp4'),
  mov: video('mov', 'mov', 'video/quicktime'),
  webm: video('webm', 'webm', 'video/webm'),
  mkv: video('mkv', 'mkv', 'video/x-matroska'),
};

function image(
  extension: string,
  format: string,
  mimeType: string,
): ExtensionPolicy {
  return policy(extension, format, MediaType.IMAGE, mimeType);
}

function audio(
  extension: string,
  format: string,
  mimeType: string,
): ExtensionPolicy {
  return policy(extension, format, MediaType.AUDIO, mimeType);
}

function video(
  extension: string,
  format: string,
  mimeType: string,
): ExtensionPolicy {
  return policy(extension, format, MediaType.VIDEO, mimeType);
}

function policy(
  extension: string,
  format: string,
  mediaType: MediaType,
  mimeType: string,
): ExtensionPolicy {
  return {
    extension,
    format,
    mediaType,
    detectedMimeType: mimeType,
    declaredMimeTypes: [mimeType, 'application/octet-stream'],
  };
}

export const normalizeOriginalFilename = (originalFilename: string): string => {
  const basename = originalFilename.split(/[\\/]/u).at(-1) ?? '';
  const withoutControls = Array.from(basename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('');
  const normalized = withoutControls.replace(/\s+/gu, ' ').trim();

  if (normalized.length === 0 || normalized.length > 255) {
    throw new DomainError(
      'INVALID_ORIGINAL_FILENAME',
      'The uploaded file name is invalid.',
      422,
    );
  }
  return normalized;
};

export const resolveExtensionPolicy = (
  originalFilename: string,
): ExtensionPolicy => {
  const normalized = normalizeOriginalFilename(originalFilename);
  const finalDot = normalized.lastIndexOf('.');
  if (finalDot <= 0 || finalDot === normalized.length - 1) {
    throw new DomainError(
      'MISSING_EXTENSION',
      'The uploaded file name must include a supported extension.',
      422,
    );
  }

  const extension = normalized.slice(finalDot + 1).toLowerCase();
  const resolved = policies[extension];
  if (resolved === undefined) {
    throw new DomainError(
      'UNSUPPORTED_EXTENSION',
      'The uploaded file extension is not supported.',
      422,
      { extension },
    );
  }
  return resolved;
};

export const supportedExtensionPolicies = Object.freeze({ ...policies });
