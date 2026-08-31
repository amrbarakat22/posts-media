import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import { PrismaService } from '@posts-media/database';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
} from '@posts-media/storage';

import { classifyWorkerHeartbeat } from '../../system/worker-health';

@Controller('system')
export class SystemController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: EnvironmentConfigurationService,
    @Inject(OBJECT_STORAGE_PORT) private readonly storage: ObjectStoragePort,
  ) {}

  @Get('live')
  public live() {
    return { status: 'LIVE' };
  }

  @Get('ready')
  public async ready() {
    try {
      await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        this.storage.exists({
          bucket: this.configuration.values.storage.originalsBucket,
          objectKey: '.healthcheck',
        }),
      ]);
      return { status: 'READY', postgres: true, storage: true };
    } catch {
      throw new HttpException(
        { status: 'NOT_READY' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('diagnostics')
  public async diagnostics() {
    const [pending, retryWait, dead] = await Promise.all([
      this.prisma.processingDispatch.count({ where: { status: 'PENDING' } }),
      this.prisma.processingDispatch.count({ where: { status: 'RETRY_WAIT' } }),
      this.prisma.processingDispatch.count({ where: { status: 'DEAD' } }),
    ]);
    const heartbeat = await this.prisma.workerInstance.findFirst({
      orderBy: { lastHeartbeatAt: 'desc' },
    });
    return {
      dispatches: { pending, retryWait, dead },
      worker:
        heartbeat === null
          ? null
          : {
              id: heartbeat.id,
              status: heartbeat.status,
              redisConnected: heartbeat.redisConnected,
              storageConnected: heartbeat.storageConnected,
              dispatcherActive: heartbeat.dispatcherActive,
              consumersActive: heartbeat.consumersActive,
              activeJobCount: heartbeat.activeJobCount,
              lastHeartbeatAt: heartbeat.lastHeartbeatAt,
              freshness: classifyWorkerHeartbeat(
                heartbeat.lastHeartbeatAt,
                new Date(),
                this.configuration.values.worker.heartbeatStaleSeconds,
              ),
            },
    };
  }
}
