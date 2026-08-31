import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import { PrismaService } from '@posts-media/database';
import { IMAGE_QUEUE, type MediaQueue } from '@posts-media/queues';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
} from '@posts-media/storage';

import { MediaQueueConsumersService } from '../consumers/media-queue-consumers.service';

@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly id = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private started = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: EnvironmentConfigurationService,
    @Inject(IMAGE_QUEUE) private readonly queue: MediaQueue,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
    private readonly consumers: MediaQueueConsumersService,
  ) {}

  public onModuleInit(): void {
    if (this.configuration.values.app.nodeEnvironment === 'test') return;
    this.started = true;
    void this.beat().catch(() => undefined);
    this.timer = setInterval(
      () => void this.beat().catch(() => undefined),
      this.configuration.values.worker.heartbeatIntervalSeconds * 1000,
    );
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    if (!this.started) return;
    await this.prisma.workerInstance
      .updateMany({
        where: { id: this.id },
        data: { status: 'STOPPED', shutdownAt: new Date() },
      })
      .catch(() => undefined);
  }

  public async beat(): Promise<void> {
    const [redisConnected, storageConnected] = await Promise.all([
      this.queue.ping().catch(() => false),
      this.storage
        .exists({
          bucket: this.configuration.values.storage.originalsBucket,
          objectKey: '.healthcheck',
        })
        .then(
          () => true,
          () => false,
        ),
    ]);
    const consumersActive = this.consumers.consumersActive;
    const status =
      redisConnected && storageConnected && consumersActive
        ? 'READY'
        : 'DEGRADED';
    await this.prisma.workerInstance.upsert({
      where: { id: this.id },
      create: {
        id: this.id,
        instanceName: hostname(),
        version: process.env.npm_package_version ?? '0.0.1',
        status,
        redisConnected,
        storageConnected,
        dispatcherActive: redisConnected,
        consumersActive,
        activeJobCount: this.consumers.activeJobCount,
      },
      update: {
        status,
        redisConnected,
        storageConnected,
        dispatcherActive: redisConnected,
        consumersActive,
        activeJobCount: this.consumers.activeJobCount,
        lastHeartbeatAt: new Date(),
        shutdownAt: null,
      },
    });
  }
}
