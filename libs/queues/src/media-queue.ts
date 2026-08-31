import type { OnModuleDestroy } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';

import type { MediaJobPayloadV1 } from './contracts/media-job-payload';

export interface MediaQueue {
  add(
    name: string,
    payload: MediaJobPayloadV1,
    options: JobsOptions,
  ): Promise<void>;
  ping(): Promise<boolean>;
}

export class BullMediaQueue implements MediaQueue, OnModuleDestroy {
  public constructor(
    private readonly queue: Queue<MediaJobPayloadV1, void, string>,
  ) {}

  public async add(
    name: string,
    payload: MediaJobPayloadV1,
    options: JobsOptions,
  ): Promise<void> {
    await this.queue.add(name, payload, options);
  }

  public async ping(): Promise<boolean> {
    await this.queue.waitUntilReady();
    return true;
  }

  public close(): Promise<void> {
    return this.queue.close();
  }

  public onModuleDestroy(): Promise<void> {
    return this.close();
  }
}
