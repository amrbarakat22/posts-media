import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { diskStorage } from 'multer';
import type { Options as MulterOptions } from 'multer';

import { RequestWithId } from '../http/middleware/request-id.middleware';
import { RequestWorkspaceService } from './request-workspace.service';

export interface UploadLimits {
  maxFilesPerRequest: number;
  /** The largest single-file size any supported media type may reach
   *  (Part I §2.9's video ceiling) — the transport-layer cap. Type-specific
   *  limits (images/audio) are enforced later in the validation pipeline. */
  maxSingleFileSizeBytes: number;
}

/**
 * Builds Multer's disk-storage options (Part I §2.8/§10.1). Files are
 * written under a per-request workspace directory with a server-generated
 * name — the client's original filename never influences a disk path.
 */
export function createMulterOptions(
  workspace: RequestWorkspaceService,
  limits: UploadLimits,
): MulterOptions {
  return {
    storage: diskStorage({
      destination: (req, _file, callback) => {
        try {
          const requestId = (req as RequestWithId).requestId;
          const directory = workspace.workspacePath(requestId);
          mkdirSync(directory, { recursive: true, mode: 0o700 });
          callback(null, directory);
        } catch (error) {
          callback(error as Error, '');
        }
      },
      filename: (_req, _file, callback) => {
        callback(null, randomUUID());
      },
    }),
    limits: {
      fileSize: limits.maxSingleFileSizeBytes,
      files: limits.maxFilesPerRequest,
      fields: 20,
      parts: limits.maxFilesPerRequest + 20,
    },
  };
}
