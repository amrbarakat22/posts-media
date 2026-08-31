import { Injectable } from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

import { OutboxClaimRepository } from './outbox-claim.repository';

@Injectable()
export class OutboxCleanupService {
  public constructor(
    private readonly repository: OutboxClaimRepository,
    private readonly configuration: EnvironmentConfigurationService,
  ) {}

  public runOnce(): Promise<{ count: number }> {
    const days = this.configuration.values.outbox.publishedRetentionDays;
    return this.repository.deletePublishedBefore(
      new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    );
  }
}
