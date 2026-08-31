import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

import { DispatchPublicationService } from './dispatch-publication.service';
import { OutboxClaimRepository } from './outbox-claim.repository';
import { OutboxCleanupService } from './outbox-cleanup.service';

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(
    private readonly repository: OutboxClaimRepository,
    private readonly publication: DispatchPublicationService,
    private readonly cleanup: OutboxCleanupService,
    private readonly configuration: EnvironmentConfigurationService,
  ) {}

  public onModuleInit(): void {
    const interval = this.configuration.values.outbox.pollIntervalMs;
    this.timer = setInterval(
      () => void this.runOnce().catch(() => undefined),
      interval,
    );
    void this.runOnce().catch(() => undefined);
  }

  public onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  public async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = this.configuration.values.outbox;
      const dispatches = await this.repository.claimBatch(
        settings.batchSize,
        settings.leaseSeconds,
      );
      const concurrency = settings.publishConcurrency;
      for (let index = 0; index < dispatches.length; index += concurrency) {
        await Promise.all(
          dispatches
            .slice(index, index + concurrency)
            .map((dispatch) => this.publication.publish(dispatch)),
        );
      }
      await this.cleanup.runOnce();
    } finally {
      this.running = false;
    }
  }
}
