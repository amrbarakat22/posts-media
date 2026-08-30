import { mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { Injectable } from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

/**
 * Manages per-request upload workspace directories (Part I §10.1). Every
 * path is derived from the configured root plus a controlled request ID —
 * never from a client-supplied filename — and workspaces are created with
 * restrictive `0700` permissions.
 */
@Injectable()
export class RequestWorkspaceService {
  public readonly rootPath: string;

  public constructor(configuration: EnvironmentConfigurationService) {
    this.rootPath = resolve(configuration.values.upload.temporaryRoot);
  }

  public workspacePath(requestId: string): string {
    return resolve(this.rootPath, requestId);
  }

  public async ensureWorkspace(requestId: string): Promise<string> {
    const path = this.workspacePath(requestId);
    await mkdir(path, { recursive: true, mode: 0o700 });
    return path;
  }

  /** True only for the root itself or a path strictly nested within it. */
  public isWithinRoot(path: string): boolean {
    const resolved = resolve(path);
    return (
      resolved === this.rootPath || resolved.startsWith(this.rootPath + sep)
    );
  }
}
