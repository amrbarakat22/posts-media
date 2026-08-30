import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PackageManifest = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
};

const readManifest = (): PackageManifest =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest;

describe('root package contract', () => {
  it('pins the approved runtime and root dependencies', () => {
    const manifest = readManifest();

    expect(manifest.engines?.node).toBe('>=24 <25');
    expect(manifest.dependencies).toMatchObject({
      '@nestjs/bullmq': expect.stringMatching(/^11\./),
      '@prisma/client': expect.stringMatching(/^7\./),
      bullmq: expect.stringMatching(/^5\.81\./),
      sharp: expect.stringMatching(/^0\.35\./),
    });
    expect(manifest.devDependencies?.prisma).toMatch(/^7\./);
  });
});
