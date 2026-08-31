import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma.service';

/**
 * Deletes idempotency rows past their `expiresAt` (Part I §11: "24h expiry
 * -> cleanup marks/removes old finalized rows safely"). Deletes regardless
 * of state — an `IN_PROGRESS`/`RETRYABLE_FAILURE` row that outlived the
 * entire TTL is abandoned and safe to forget; the key becomes acquirable
 * again as a fresh request. Callers (the worker's scheduled maintenance,
 * Task 18+) decide the interval; this service only performs one pass.
 */
@Injectable()
export class IdempotencyCleanupService {
  private readonly logger = new Logger(IdempotencyCleanupService.name);

  public constructor(private readonly prisma: PrismaService) {}

  public async removeExpired(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.idempotencyRequest.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    if (count > 0) {
      this.logger.log(`Removed ${count} expired idempotency request(s).`);
    }
    return count;
  }
}
