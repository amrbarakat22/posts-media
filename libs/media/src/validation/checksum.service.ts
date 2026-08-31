import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { DomainError } from '@posts-media/domain';

export class ChecksumService {
  public async calculate(temporaryPath: string): Promise<string> {
    try {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(temporaryPath)) {
        hash.update(chunk as Buffer);
      }
      return hash.digest('hex');
    } catch {
      throw new DomainError(
        'CHECKSUM_CALCULATION_FAILED',
        'The uploaded file checksum could not be calculated.',
        422,
      );
    }
  }
}
