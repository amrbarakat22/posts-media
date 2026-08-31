import { open } from 'node:fs/promises';

import { DomainError, MediaType } from '@posts-media/domain';

export interface SignatureDetection {
  readonly format: string;
  readonly mimeType: string;
  readonly mediaType?: MediaType;
  readonly containerFamily?: 'iso-bmff' | 'ebml';
  readonly containerVariant?: 'mp4' | 'mov' | 'm4a' | 'webm' | 'mkv';
}

const MAX_HEADER_BYTES = 64;

const known = (
  format: string,
  mimeType: string,
  mediaType: MediaType,
): SignatureDetection => ({ format, mimeType, mediaType });

const startsWith = (header: Buffer, bytes: readonly number[]): boolean =>
  bytes.every((byte, index) => header[index] === byte);

const asciiAt = (header: Buffer, offset: number, value: string): boolean =>
  header.length >= offset + value.length &&
  header.subarray(offset, offset + value.length).toString('ascii') === value;

const isMpegAudioFrame = (header: Buffer): boolean => {
  if (header.length < 4 || header[0] !== 0xff) {
    return false;
  }
  const second = header[1] ?? 0;
  const third = header[2] ?? 0;
  const version = (second >> 3) & 0x03;
  const layer = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  return (
    (second & 0xe0) === 0xe0 &&
    version !== 0x01 &&
    layer !== 0 &&
    bitrateIndex !== 0 &&
    bitrateIndex !== 0x0f &&
    sampleRateIndex !== 0x03
  );
};

const isAdts = (header: Buffer): boolean =>
  header.length >= 4 &&
  header[0] === 0xff &&
  ((header[1] ?? 0) & 0xf6) === 0xf0;

export const detectHeaderSignature = (header: Buffer): SignatureDetection => {
  if (header.length === 0) {
    throw new DomainError('EMPTY_FILE', 'The uploaded file is empty.', 422);
  }
  if (startsWith(header, [0xff, 0xd8, 0xff])) {
    return known('jpeg', 'image/jpeg', MediaType.IMAGE);
  }
  if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return known('png', 'image/png', MediaType.IMAGE);
  }
  if (asciiAt(header, 0, 'RIFF') && asciiAt(header, 8, 'WEBP')) {
    return known('webp', 'image/webp', MediaType.IMAGE);
  }
  if (asciiAt(header, 0, 'RIFF') && asciiAt(header, 8, 'WAVE')) {
    return known('wav', 'audio/wav', MediaType.AUDIO);
  }
  if (asciiAt(header, 0, 'ID3') || isMpegAudioFrame(header)) {
    return known('mp3', 'audio/mpeg', MediaType.AUDIO);
  }
  if (isAdts(header)) {
    return known('aac', 'audio/aac', MediaType.AUDIO);
  }
  if (asciiAt(header, 0, 'fLaC')) {
    return known('flac', 'audio/flac', MediaType.AUDIO);
  }
  if (asciiAt(header, 0, 'OggS')) {
    return known('ogg', 'audio/ogg', MediaType.AUDIO);
  }
  if (asciiAt(header, 4, 'ftyp')) {
    const majorBrand = header.subarray(8, 12).toString('ascii');
    return {
      format: 'iso-bmff',
      mimeType: 'application/mp4',
      containerFamily: 'iso-bmff',
      ...(majorBrand === 'qt  '
        ? { containerVariant: 'mov' as const }
        : majorBrand === 'M4A '
          ? { containerVariant: 'm4a' as const }
          : {}),
    };
  }
  if (startsWith(header, [0x1a, 0x45, 0xdf, 0xa3])) {
    const headerText = header.toString('ascii').toLowerCase();
    return {
      format: 'ebml',
      mimeType: 'application/x-ebml',
      containerFamily: 'ebml',
      ...(headerText.includes('webm')
        ? { containerVariant: 'webm' as const }
        : headerText.includes('matroska')
          ? { containerVariant: 'mkv' as const }
          : {}),
    };
  }
  throw new DomainError(
    'UNKNOWN_FILE_SIGNATURE',
    'The uploaded file signature is not recognized.',
    422,
  );
};

export class SignatureDetectorService {
  public async detect(temporaryPath: string): Promise<SignatureDetection> {
    let handle;
    try {
      handle = await open(temporaryPath, 'r');
      const header = Buffer.alloc(MAX_HEADER_BYTES);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      return detectHeaderSignature(header.subarray(0, bytesRead));
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError(
        'CORRUPTED_FILE',
        'The uploaded file could not be inspected.',
        422,
      );
    } finally {
      await handle?.close();
    }
  }
}
