import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

import { RequestWorkspaceService } from './request-workspace.service';

const STALE_SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Removes upload workspace directories (Part I §10.1). `removeWorkspace`
 * is called on the immediate success/failure path of a request (in a
 * `finally`); a periodic sweep removes anything left behind by a crashed
 * or killed process once it is older than the configured max age.
 */
@Injectable()
export class UploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadCleanupService.name);
  private sweepTimer?: NodeJS.Timeout;

  public constructor(
    private readonly workspace: RequestWorkspaceService,
    private readonly configuration: EnvironmentConfigurationService,
  ) {}

  public onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      this.removeStaleWorkspaces().catch((error: unknown) => {
        this.logger.error(
          'Stale upload workspace sweep failed',
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, STALE_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  public onModuleDestroy(): void {
    if (this.sweepTimer !== undefined) {
      clearInterval(this.sweepTimer);
    }
  }

  /**
   * Removes one workspace directory. Refuses to touch anything outside
   * the configured upload root, guarding against a path-traversal or
   * otherwise malformed path ever reaching a filesystem delete.
   */
  public async removeWorkspace(path: string): Promise<void> {
    if (!this.workspace.isWithinRoot(path)) {
      throw new Error(
        `Refusing to remove path outside the upload root: ${path}`,
      );
    }
    await rm(path, { recursive: true, force: true });
  }

  public async removeStaleWorkspaces(): Promise<string[]> {
    const maxAgeMs =
      this.configuration.values.upload.temporaryMaxAgeMinutes * 60_000;
    const removed: string[] = [];

    let entries: string[];
    try {
      entries = await readdir(this.workspace.rootPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return removed;
      }
      throw error;
    }

    const now = Date.now();
    for (const entry of entries) {
      const entryPath = join(this.workspace.rootPath, entry);
      const info = await stat(entryPath).catch(() => undefined);
      if (info === undefined || !info.isDirectory()) {
        continue;
      }
      if (now - info.mtimeMs > maxAgeMs) {
        await this.removeWorkspace(entryPath);
        removed.push(entryPath);
      }
    }

    return removed;
  }
}
