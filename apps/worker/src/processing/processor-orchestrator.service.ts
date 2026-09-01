import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import type { MediaJobPayloadV1 } from '@posts-media/queues';
import type { Media } from '@prisma/client';

import { WorkerClaimService } from './worker-claim.service';
import { ProcessingWorkspaceService } from './processing-workspace.service';

export type ProcessorHandler = (
  media: Media,
  workspace: string,
  leaseToken: string,
  attemptId: string,
) => Promise<void>;

@Injectable()
export class ProcessorOrchestratorService {
  public constructor(
    private readonly claims: WorkerClaimService,
    private readonly workspace: ProcessingWorkspaceService,
    private readonly configuration: EnvironmentConfigurationService,
  ) {}

  public async execute(
    payload: MediaJobPayloadV1,
    attemptsMade: number,
    handler: ProcessorHandler,
    workerInstanceId = 'worker',
  ): Promise<void> {
    const leaseToken = randomUUID();
    const claim = await this.claims.claim(
      payload.mediaId,
      payload.generation,
      `media-${payload.mediaId}-generation-${payload.generation}`,
      this.configuration.values.worker.processingLeaseSeconds,
      leaseToken,
    );
    if (claim === null) return;

    const attempt = await this.claims.createAttempt(
      payload.mediaId,
      payload.generation,
      attemptsMade + 1,
      `media-${payload.mediaId}-generation-${payload.generation}`,
      payload.processingProfile,
      workerInstanceId,
    );
    const directory = await this.workspace.create(
      payload.mediaId,
      payload.generation,
      attempt.id,
    );
    const renewal = setInterval(
      () =>
        void this.claims.renew(
          payload.mediaId,
          payload.generation,
          leaseToken,
          this.configuration.values.worker.processingLeaseSeconds,
        ),
      this.configuration.values.worker.processingLeaseRenewSeconds * 1000,
    );
    try {
      await this.workspace.downloadAndVerify(
        claim.media,
        join(directory, 'original'),
      );
      await handler(claim.media, directory, leaseToken, attempt.id);
      await this.claims.complete(
        payload.mediaId,
        payload.generation,
        leaseToken,
        attempt.id,
      );
    } catch (error) {
      const final =
        attemptsMade + 1 >= this.configuration.values.worker.mediaJobAttempts;
      await this.claims.fail(
        payload.mediaId,
        payload.generation,
        leaseToken,
        attempt.id,
        final,
        'PROCESSING_FAILED',
        error instanceof Error ? error.message : 'Processing failed',
      );
      throw new Error('PROCESSING_FAILED');
    } finally {
      clearInterval(renewal);
      await this.workspace.cleanup(directory).catch(() => undefined);
    }
  }
}
