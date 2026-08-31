import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@posts-media/database';
import { Prisma } from '@prisma/client';
import type { DispatchReason, DispatchStatus } from '@prisma/client';

export interface ClaimedDispatch {
  readonly id: string;
  readonly mediaId: string;
  readonly generation: number;
  readonly reason: DispatchReason;
  readonly queueName: string;
  readonly jobName: string;
  readonly jobId: string;
  readonly payloadVersion: number;
  readonly payload: unknown;
  readonly publishAttempts: number;
  readonly leaseToken: string;
}

interface ClaimedDispatchRow extends Omit<ClaimedDispatch, 'leaseToken'> {
  readonly status: DispatchStatus;
}

@Injectable()
export class OutboxClaimRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async claimBatch(
    batchSize: number,
    leaseSeconds: number,
  ): Promise<readonly ClaimedDispatch[]> {
    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

    return this.prisma.withTransaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedDispatchRow[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "ProcessingDispatch"
          WHERE (
            "status" = 'PENDING'::"DispatchStatus"
            OR ("status" = 'RETRY_WAIT'::"DispatchStatus"
              AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now}))
            OR ("status" = 'PUBLISHING'::"DispatchStatus"
              AND "leaseExpiresAt" IS NOT NULL AND "leaseExpiresAt" <= ${now})
          )
          ORDER BY "createdAt", "id"
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "ProcessingDispatch" AS dispatch
        SET "status" = 'PUBLISHING'::"DispatchStatus",
            "leaseToken" = ${leaseToken}::uuid,
            "leaseExpiresAt" = ${leaseExpiresAt},
            "updatedAt" = ${now}
        FROM candidates
        WHERE dispatch."id" = candidates."id"
        RETURNING dispatch."id", dispatch."mediaId", dispatch."generation",
          dispatch."reason", dispatch."queueName", dispatch."jobName",
          dispatch."jobId", dispatch."payloadVersion", dispatch."payload",
          dispatch."publishAttempts", dispatch."status"
      `);

      return rows.map((row) => ({ ...row, leaseToken }));
    });
  }

  public async markPublished(id: string, leaseToken: string): Promise<boolean> {
    const result = await this.prisma.processingDispatch.updateMany({
      where: { id, status: 'PUBLISHING', leaseToken },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return result.count === 1;
  }

  public async markRetryWait(
    id: string,
    leaseToken: string,
    nextAttemptAt: Date,
    errorCode: string,
    errorMessage: string,
  ): Promise<boolean> {
    const result = await this.prisma.processingDispatch.updateMany({
      where: { id, status: 'PUBLISHING', leaseToken },
      data: {
        status: 'RETRY_WAIT',
        publishAttempts: { increment: 1 },
        nextAttemptAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode.slice(0, 64),
        lastErrorMessage: errorMessage.slice(0, 1000),
      },
    });
    return result.count === 1;
  }

  public async markDead(
    id: string,
    leaseToken: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<boolean> {
    const result = await this.prisma.processingDispatch.updateMany({
      where: { id, status: 'PUBLISHING', leaseToken },
      data: {
        status: 'DEAD',
        publishAttempts: { increment: 1 },
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode.slice(0, 64),
        lastErrorMessage: errorMessage.slice(0, 1000),
      },
    });
    return result.count === 1;
  }

  public deletePublishedBefore(before: Date): Promise<{ count: number }> {
    return this.prisma.processingDispatch.deleteMany({
      where: { status: 'PUBLISHED', publishedAt: { lt: before } },
    });
  }
}
