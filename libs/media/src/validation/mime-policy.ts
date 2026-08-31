import { DomainError } from '@posts-media/domain';

import type { ExtensionPolicy } from './extension-policy';

const aliases: Readonly<Record<string, string>> = Object.freeze({
  'application/octet-stream': 'application/octet-stream',
  'application/ogg': 'audio/ogg',
  'audio/aac': 'audio/aac',
  'audio/aacp': 'audio/aac',
  'audio/flac': 'audio/flac',
  'audio/m4a': 'audio/mp4',
  'audio/mp3': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'audio/mpeg': 'audio/mpeg',
  'audio/ogg': 'audio/ogg',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-aac': 'audio/aac',
  'audio/x-flac': 'audio/flac',
  'audio/x-m4a': 'audio/mp4',
  'audio/x-mp3': 'audio/mpeg',
  'audio/x-wav': 'audio/wav',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/x-png': 'image/png',
  'video/matroska': 'video/x-matroska',
  'video/mp4': 'video/mp4',
  'video/quicktime': 'video/quicktime',
  'video/webm': 'video/webm',
  'video/x-matroska': 'video/x-matroska',
});

export const canonicalizeDeclaredMimeType = (declared: string): string => {
  const normalized = declared.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const canonical = aliases[normalized];
  if (canonical === undefined) {
    throw new DomainError(
      'UNSUPPORTED_MIME_TYPE',
      'The uploaded file MIME type is not supported.',
      422,
      normalized.length === 0 ? undefined : { declaredMimeType: normalized },
    );
  }
  return canonical;
};

export const isDeclaredMimeCompatible = (
  policy: ExtensionPolicy,
  canonicalDeclaredMimeType: string,
): boolean =>
  canonicalDeclaredMimeType === 'application/octet-stream' ||
  canonicalDeclaredMimeType === policy.detectedMimeType;
