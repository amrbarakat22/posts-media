import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RequestWorkspaceService } from './request-workspace.service';

const fakeConfiguration = (temporaryRoot: string) =>
  ({
    values: { upload: { temporaryRoot, temporaryMaxAgeMinutes: 60 } },
  }) as never;

describe('RequestWorkspaceService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspace-root-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates a private (0700) request-specific directory under the root', async () => {
    const service = new RequestWorkspaceService(fakeConfiguration(root));
    const requestId = randomUUID();

    const path = await service.ensureWorkspace(requestId);

    expect(path).toBe(join(root, requestId));
    const info = await stat(path);
    expect(info.isDirectory()).toBe(true);
    expect(info.mode & 0o777).toBe(0o700);
  });

  it('never derives the workspace path from anything but the request id', () => {
    const service = new RequestWorkspaceService(fakeConfiguration(root));

    expect(service.workspacePath('abc')).toBe(join(root, 'abc'));
    expect(RequestWorkspaceService.prototype.workspacePath.length).toBe(1);
  });

  it('considers only the root and its descendants "within root"', () => {
    const service = new RequestWorkspaceService(fakeConfiguration(root));

    expect(service.isWithinRoot(root)).toBe(true);
    expect(service.isWithinRoot(join(root, 'child'))).toBe(true);
    expect(service.isWithinRoot(join(root, '..', 'sibling'))).toBe(false);
    expect(service.isWithinRoot('/etc/passwd')).toBe(false);
  });
});
