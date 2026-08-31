import { stat } from 'node:fs/promises';

import type { FingerprintFile } from '@posts-media/database';

import { ChecksumService } from './checksum.service';
import { normalizeOriginalFilename } from './extension-policy';
import { canonicalizeDeclaredMimeType } from './mime-policy';

const safeFilename = (originalFilename: string): string => {
  try {
    return normalizeOriginalFilename(originalFilename);
  } catch {
    return originalFilename;
  }
};

const safeMimeType = (declaredMimeType: string): string => {
  try {
    return canonicalizeDeclaredMimeType(declaredMimeType);
  } catch {
    return declaredMimeType;
  }
};

/**
 * Builds the per-file fingerprint inputs for every *submitted* file,
 * independent of whether it later passes validation (Part I §11: "A
 * complete file hash must be available before multipart request
 * fingerprint finalization"). A file that will ultimately be rejected
 * still needs a stable checksum so the whole request's fingerprint is
 * deterministic and the atomic-rejection outcome remains replayable.
 * Best-effort normalizes the filename/MIME, falling back to the raw
 * client-supplied value rather than throwing, since a malformed value is
 * itself part of what makes the request fingerprint unique.
 */
export const buildFingerprintFiles = async (
  files: readonly Express.Multer.File[],
): Promise<FingerprintFile[]> => {
  const checksum = new ChecksumService();
  return Promise.all(
    files.map(async (file) => {
      const stats = await stat(file.path);
      return {
        originalFilename: safeFilename(file.originalname),
        declaredMimeType: safeMimeType(file.mimetype),
        sizeBytes: stats.size.toString(),
        checksumSha256: await checksum.calculate(file.path),
      };
    }),
  );
};
