import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
  type ObjectRef,
} from '@posts-media/storage';

@Injectable()
export class ProcessingWorkspaceService {
  private readonly root: string;

  public constructor(
    configuration: EnvironmentConfigurationService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {
    this.root = resolve(configuration.values.worker.temporaryRoot);
  }

  public async create(
    mediaId: string,
    generation: number,
    attemptId: string,
  ): Promise<string> {
    const directory = this.contained(mediaId, String(generation), attemptId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  public async downloadAndVerify(
    media: {
      originalBucket: string;
      originalObjectKey: string;
      originalSize: bigint;
      checksumSha256: string;
    },
    destination: string,
  ): Promise<void> {
    const ref: ObjectRef = {
      bucket: media.originalBucket,
      objectKey: media.originalObjectKey,
    };
    await this.storage.downloadToFile(ref, destination);
    const details = await stat(destination);
    if (BigInt(details.size) !== media.originalSize)
      throw new Error('PROCESSING_CHECKSUM_MISMATCH');
    const checksum = await new Promise<string>((resolveHash, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(destination);
      stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolveHash(hash.digest('hex')));
    });
    if (checksum !== media.checksumSha256)
      throw new Error('PROCESSING_CHECKSUM_MISMATCH');
  }

  public cleanup(directory: string): Promise<void> {
    if (!this.isContained(directory))
      throw new Error('PROCESSING_WORKSPACE_OUTSIDE_ROOT');
    return rm(directory, { recursive: true, force: true });
  }

  public async cleanupStale(maxAgeMs: number): Promise<number> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(
      () => [],
    );
    let removed = 0;
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      const path = this.contained(entry.name);
      const details = await stat(path).catch(() => undefined);
      if (details !== undefined && details.mtimeMs < cutoff) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }

  private contained(...parts: string[]): string {
    const path = resolve(join(this.root, ...parts));
    if (!this.isContained(path))
      throw new Error('PROCESSING_WORKSPACE_OUTSIDE_ROOT');
    return path;
  }

  private isContained(path: string): boolean {
    if (!isAbsolute(path)) return false;
    const rel = relative(this.root, resolve(path));
    return rel !== '' && !rel.startsWith('..') && !rel.includes('..' + '/');
  }
}
