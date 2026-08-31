import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';

@Controller('system')
export class SystemController {
  public constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  public live() {
    return { status: 'LIVE' };
  }

  @Get('ready')
  public async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'READY', postgres: true };
    } catch {
      throw new HttpException(
        { status: 'NOT_READY', postgres: false },
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
            },
    };
  }
}
