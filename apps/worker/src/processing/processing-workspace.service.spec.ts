import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProcessingWorkspaceService } from './processing-workspace.service';

describe('ProcessingWorkspaceService', () => {
  const root = join(tmpdir(), `posts-media-workspace-${process.pid}`);
  const service = new ProcessingWorkspaceService(
    { values: { worker: { temporaryRoot: root } } } as never,
    {} as never,
  );

  beforeAll(() => mkdir(root, { recursive: true }));
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('creates contained per-attempt workspaces and rejects traversal', async () => {
    const path = await service.create('media-1', 1, 'attempt-1');
    expect(path).toBe(join(root, 'media-1', '1', 'attempt-1'));
    await expect(service.create('../outside', 1, 'attempt-2')).rejects.toThrow(
      'PROCESSING_WORKSPACE_OUTSIDE_ROOT',
    );
    await service.cleanup(path);
  });
});
