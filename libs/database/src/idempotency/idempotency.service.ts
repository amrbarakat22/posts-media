import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@posts-media/domain';
import { Prisma } from '@prisma/client';
import type { IdempotencyOperation } from '@prisma/client';

import { PrismaService } from '../prisma.service';

/** Retry-After hint (seconds) returned with `IDEMPOTENCY_REQUEST_IN_PROGRESS` (Part I §2.11). */
export const IDEMPOTENCY_IN_PROGRESS_RETRY_AFTER_SECONDS = 2;

export interface IdempotencyOperationContext {
  readonly key: string;
  readonly operation: IdempotencyOperation;
  readonly method: string;
  readonly routeTemplate: string;
}

/**
 * What a protected mutation ultimately did — the exact HTTP response that
 * gets replayed verbatim on a repeated request with the same key and
 * fingerprint. Must never contain presigned URLs or anything else that is
 * only valid at generation time (Part I §6.4/§11).
 */
export interface IdempotentOutcome {
  readonly responseStatus: number;
  readonly responseBody: Prisma.InputJsonValue;
  readonly targetResourceId?: string;
  readonly resourceIds?: Prisma.InputJsonValue;
}

export type IdempotentAction = () => Promise<IdempotentOutcome>;

export interface IdempotentExecution {
  readonly outcome: IdempotentOutcome;
  readonly replayed: boolean;
}

const keyReusedError = (): DomainError =>
  new DomainError(
    'IDEMPOTENCY_KEY_REUSED',
    'This Idempotency-Key was already used for a different request.',
    409,
  );

const requestInProgressError = (): DomainError =>
  new DomainError(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'A request with this Idempotency-Key is already being processed.',
    409,
    { retryAfterSeconds: IDEMPOTENCY_IN_PROGRESS_RETRY_AFTER_SECONDS },
  );

type Claim =
  | { readonly kind: 'ACQUIRED' }
  | { readonly kind: 'REPLAY'; readonly outcome: IdempotentOutcome }
  | { readonly kind: 'CONFLICT' }
  | { readonly kind: 'IN_PROGRESS' };

/**
 * The HTTP idempotency core (Part I §2.11/§11). Wraps a mutation's actual
 * work (`action`) so that repeating the same `Idempotency-Key` with the
 * same logical request replays the original stable result instead of
 * re-executing it, while a different request under the same key is
 * rejected. Callers (Task 10/11/17) are responsible for computing the
 * fingerprint and translating `action`'s own domain errors into a stable,
 * *finalizable* `IdempotentOutcome` — only genuinely unexpected failures
 * should be allowed to throw out of `action`, since those leave the key
 * retryable rather than finalized.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly ttlHours: number,
    private readonly leaseSeconds: number,
  ) {}

  public async executeIdempotent(
    context: IdempotencyOperationContext,
    fingerprint: string,
    action: IdempotentAction,
  ): Promise<IdempotentExecution> {
    const claim = await this.acquire(context, fingerprint);

    if (claim.kind === 'REPLAY') {
      return { outcome: claim.outcome, replayed: true };
    }
    if (claim.kind === 'CONFLICT') {
      throw keyReusedError();
    }
    if (claim.kind === 'IN_PROGRESS') {
      throw requestInProgressError();
    }

    try {
      const outcome = await action();
      await this.finalize(context.key, outcome);
      return { outcome, replayed: false };
    } catch (error) {
      await this.markRetryableFailure(context.key);
      throw error;
    }
  }

  private async acquire(
    context: IdempotencyOperationContext,
    fingerprint: string,
  ): Promise<Claim> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseSeconds * 1000);
    const expiresAt = new Date(now.getTime() + this.ttlHours * 3_600_000);

    try {
      await this.prisma.idempotencyRequest.create({
        data: {
          key: context.key,
          operation: context.operation,
          method: context.method,
          routeTemplate: context.routeTemplate,
          requestFingerprint: fingerprint,
          state: 'IN_PROGRESS',
          leaseToken: randomUUID(),
          leaseExpiresAt,
          expiresAt,
        },
      });
      return { kind: 'ACQUIRED' };
    } catch (error) {
      if (!isUniqueKeyViolation(error)) throw error;
    }

    return this.reconcileExisting(context, fingerprint, leaseExpiresAt);
  }

  private async reconcileExisting(
    context: IdempotencyOperationContext,
    fingerprint: string,
    leaseExpiresAt: Date,
  ): Promise<Claim> {
    const { key } = context;
    const existing = await this.prisma.idempotencyRequest.findUnique({
      where: { key },
    });
    // Deleted by cleanup between our failed insert and this read — safe
    // to treat this as a brand new key and retry acquisition once.
    if (existing === null) return this.acquire(context, fingerprint);

    if (existing.state === 'FINALIZED') {
      if (existing.requestFingerprint !== fingerprint) {
        return { kind: 'CONFLICT' };
      }
      return {
        kind: 'REPLAY',
        outcome: {
          responseStatus: existing.responseStatus ?? 200,
          responseBody: (existing.responseBody ??
            null) as Prisma.InputJsonValue,
          ...(existing.targetResourceId !== null
            ? { targetResourceId: existing.targetResourceId }
            : {}),
          ...(existing.resourceIds !== null
            ? { resourceIds: existing.resourceIds as Prisma.InputJsonValue }
            : {}),
        },
      };
    }

    const reclaimable =
      existing.state === 'RETRYABLE_FAILURE' ||
      (existing.state === 'IN_PROGRESS' &&
        existing.leaseExpiresAt !== null &&
        existing.leaseExpiresAt.getTime() <= Date.now());

    if (!reclaimable) {
      return existing.requestFingerprint === fingerprint
        ? { kind: 'IN_PROGRESS' }
        : { kind: 'CONFLICT' };
    }

    if (existing.requestFingerprint !== fingerprint) {
      return { kind: 'CONFLICT' };
    }

    const reclaimed = await this.prisma.idempotencyRequest.updateMany({
      where: {
        key,
        requestFingerprint: fingerprint,
        OR: [
          { state: 'RETRYABLE_FAILURE' },
          { state: 'IN_PROGRESS', leaseExpiresAt: { lte: new Date() } },
        ],
      },
      data: {
        state: 'IN_PROGRESS',
        leaseToken: randomUUID(),
        leaseExpiresAt,
      },
    });

    // Another process reclaimed it first between our read and this
    // conditional update — it now owns the lease, so this request must
    // wait rather than run the action twice.
    return reclaimed.count === 1
      ? { kind: 'ACQUIRED' }
      : { kind: 'IN_PROGRESS' };
  }

  private async finalize(
    key: string,
    outcome: IdempotentOutcome,
  ): Promise<void> {
    const updated = await this.prisma.idempotencyRequest.updateMany({
      where: { key },
      data: {
        state: 'FINALIZED',
        responseStatus: outcome.responseStatus,
        responseBody: outcome.responseBody,
        targetResourceId: outcome.targetResourceId ?? null,
        resourceIds: outcome.resourceIds ?? Prisma.JsonNull,
        finalizedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count !== 1) {
      this.logger.warn(
        `Idempotency key ${key} could not be finalized (lease likely reclaimed by a later request).`,
      );
    }
  }

  private async markRetryableFailure(key: string): Promise<void> {
    await this.prisma.idempotencyRequest
      .updateMany({
        where: { key },
        data: {
          state: 'RETRYABLE_FAILURE',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
      .catch((cleanupError: unknown) => {
        this.logger.error(
          `Failed to mark idempotency key ${key} as RETRYABLE_FAILURE`,
          cleanupError instanceof Error ? cleanupError.stack : undefined,
        );
      });
  }
}

const isUniqueKeyViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === 'P2002';
