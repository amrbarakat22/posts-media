import { mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RequestWorkspaceService } from './request-workspace.service';
import { UploadCleanupService } from './upload-cleanup.service';

const fakeConfiguration = (
  temporaryRoot: string,
  temporaryMaxAgeMinutes = 60,
) =>
  ({
    values: { upload: { temporaryRoot, temporaryMaxAgeMinutes } },
  }) as never;

describe('UploadCleanupService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cleanup-root-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('removeWorkspace', () => {
    it('removes a workspace directory within the configured root', async () => {
      const workspace = new RequestWorkspaceService(fakeConfiguration(root));
      const cleanup = new UploadCleanupService(
        workspace,
        fakeConfiguration(root),
      );
      const path = await workspace.ensureWorkspace('req-1');

      await cleanup.removeWorkspace(path);

      await expect(stat(path)).rejects.toThrow();
    });

    it('refuses to remove a path outside the configured root', async () => {
      const workspace = new RequestWorkspaceService(fakeConfiguration(root));
      const cleanup = new UploadCleanupService(
        workspace,
        fakeConfiguration(root),
      );
      const outsidePath = await mkdtemp(join(tmpdir(), 'outside-'));

      await expect(cleanup.removeWorkspace(outsidePath)).rejects.toThrow(
        /outside the upload root/,
      );
      await expect(stat(outsidePath)).resolves.toBeDefined();

      await rm(outsidePath, { recursive: true, force: true });
    });

    it('refuses a path-traversal attempt disguised as a workspace path', async () => {
      const workspace = new RequestWorkspaceService(fakeConfiguration(root));
      const cleanup = new UploadCleanupService(
        workspace,
        fakeConfiguration(root),
      );

      await expect(
        cleanup.removeWorkspace(join(root, '..', 'sibling')),
      ).rejects.toThrow(/outside the upload root/);
    });
  });

  describe('removeStaleWorkspaces', () => {
    it('removes only directories older than the configured max age', async () => {
      const workspace = new RequestWorkspaceService(fakeConfiguration(root));
      const cleanup = new UploadCleanupService(
        workspace,
        fakeConfiguration(root, 60),
      );

      const stalePath = join(root, 'stale-request');
      const freshPath = join(root, 'fresh-request');
      await mkdir(stalePath, { recursive: true });
      await mkdir(freshPath, { recursive: true });

      const seventyMinutesAgo = new Date(Date.now() - 70 * 60_000);
      await utimes(stalePath, seventyMinutesAgo, seventyMinutesAgo);

      const removed = await cleanup.removeStaleWorkspaces();

      expect(removed).toEqual([stalePath]);
      await expect(stat(stalePath)).rejects.toThrow();
      await expect(stat(freshPath)).resolves.toBeDefined();
    });

    it('does nothing when the upload root does not exist yet', async () => {
      await rm(root, { recursive: true, force: true });
      const workspace = new RequestWorkspaceService(fakeConfiguration(root));
      const cleanup = new UploadCleanupService(
        workspace,
        fakeConfiguration(root),
      );

      await expect(cleanup.removeStaleWorkspaces()).resolves.toEqual([]);
    });
  });
});
