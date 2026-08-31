import { randomUUID } from 'node:crypto';

import type {
  IdempotencyOperationContext,
  IdempotentOutcome,
} from './idempotency.service';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from '../prisma.service';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://posts:posts@postgres:5432/posts_media_test';

const prisma = new PrismaService(databaseUrl);

const LEASE_SECONDS = 1;
const service = new IdempotencyService(prisma, 24, LEASE_SECONDS);

const context = (): IdempotencyOperationContext => ({
  key: randomUUID(),
  operation: 'CREATE_POST',
  method: 'POST',
  routeTemplate: '/api/posts',
});

const outcome = (id: string): IdempotentOutcome => ({
  responseStatus: 201,
  responseBody: { id, title: 'x' },
  targetResourceId: id,
});

describe('IdempotencyService (integration)', () => {
  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  afterEach(async () => {
    await prisma.idempotencyRequest.deleteMany();
    await prisma.post.deleteMany();
  });

  it('acquires a fresh key and finalizes it as FINALIZED with the action outcome', async () => {
    const ctx = context();
    const fingerprint = 'a'.repeat(64);
    const resourceId = randomUUID();

    const result = await service.executeIdempotent(ctx, fingerprint, () =>
      Promise.resolve(outcome(resourceId)),
    );

    expect(result.replayed).toBe(false);
    expect(result.outcome).toMatchObject({
      responseStatus: 201,
      targetResourceId: resourceId,
    });

    const stored = await prisma.idempotencyRequest.findUniqueOrThrow({
      where: { key: ctx.key },
    });
    expect(stored.state).toBe('FINALIZED');
    expect(stored.responseStatus).toBe(201);
    expect(stored.leaseToken).toBeNull();
    expect(stored.finalizedAt).not.toBeNull();
  });

  it('replays the original outcome for the same key and fingerprint without re-running the action', async () => {
    const ctx = context();
    const fingerprint = 'b'.repeat(64);
    const resourceId = randomUUID();
    let calls = 0;
    const action = () => {
      calls += 1;
      return Promise.resolve(outcome(resourceId));
    };

    const first = await service.executeIdempotent(ctx, fingerprint, action);
    const second = await service.executeIdempotent(ctx, fingerprint, action);

    expect(calls).toBe(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.outcome).toEqual(first.outcome);
  });

  it('rejects the same key with a different fingerprint as IDEMPOTENCY_KEY_REUSED', async () => {
    const ctx = context();
    await service.executeIdempotent(ctx, 'c'.repeat(64), () =>
      Promise.resolve(outcome(randomUUID())),
    );

    await expect(
      service.executeIdempotent(ctx, 'd'.repeat(64), () =>
        Promise.resolve(outcome(randomUUID())),
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      httpStatus: 409,
    });
  });

  it('rejects a concurrent same-key request while the first is still in progress', async () => {
    const ctx = context();
    const fingerprint = 'e'.repeat(64);
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstPromise = service.executeIdempotent(
      ctx,
      fingerprint,
      async () => {
        await gate;
        return outcome(randomUUID());
      },
    );

    // Give the first request time to acquire the lease before firing the second.
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(
      service.executeIdempotent(ctx, fingerprint, () =>
        Promise.resolve(outcome(randomUUID())),
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      httpStatus: 409,
      details: { retryAfterSeconds: 2 },
    });

    releaseFirst();
    await firstPromise;
  });

  it('rejects a different fingerprint under the same key while it is in progress', async () => {
    const ctx = context();
    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstPromise = service.executeIdempotent(
      ctx,
      'f'.repeat(64),
      async () => {
        await gate;
        return outcome(randomUUID());
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    await expect(
      service.executeIdempotent(ctx, 'a1'.repeat(32), () =>
        Promise.resolve(outcome(randomUUID())),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    releaseFirst();
    await firstPromise;
  });

  it('allows the same request to reacquire after its lease expires', async () => {
    const ctx = context();
    const fingerprint = 'g'.repeat(64);

    // Simulate a crashed first attempt: acquire the lease, then never
    // finalize it, and wait past the (1s, for this test) lease duration.
    await prisma.idempotencyRequest.create({
      data: {
        key: ctx.key,
        operation: ctx.operation,
        method: ctx.method,
        routeTemplate: ctx.routeTemplate,
        requestFingerprint: fingerprint,
        state: 'IN_PROGRESS',
        leaseToken: randomUUID(),
        leaseExpiresAt: new Date(Date.now() - 1000),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const resourceId = randomUUID();
    const result = await service.executeIdempotent(ctx, fingerprint, () =>
      Promise.resolve(outcome(resourceId)),
    );

    expect(result.replayed).toBe(false);
    expect(result.outcome.targetResourceId).toBe(resourceId);
  });

  it('allows the same request to reacquire after a RETRYABLE_FAILURE', async () => {
    const ctx = context();
    const fingerprint = 'h'.repeat(64);

    await expect(
      service.executeIdempotent(ctx, fingerprint, () =>
        Promise.reject(new Error('simulated infrastructure failure')),
      ),
    ).rejects.toThrow('simulated infrastructure failure');

    const afterFailure = await prisma.idempotencyRequest.findUniqueOrThrow({
      where: { key: ctx.key },
    });
    expect(afterFailure.state).toBe('RETRYABLE_FAILURE');

    const resourceId = randomUUID();
    const retried = await service.executeIdempotent(ctx, fingerprint, () =>
      Promise.resolve(outcome(resourceId)),
    );

    expect(retried.replayed).toBe(false);
    expect(retried.outcome.targetResourceId).toBe(resourceId);
  });

  it('rejects a different fingerprint reusing a key left RETRYABLE_FAILURE', async () => {
    const ctx = context();
    await expect(
      service.executeIdempotent(ctx, 'i'.repeat(64), () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    await expect(
      service.executeIdempotent(ctx, 'j'.repeat(64), () =>
        Promise.resolve(outcome(randomUUID())),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  describe('transactional coupling (Task 10 usage pattern)', () => {
    it('finalize() inside a caller transaction commits together with the caller domain writes', async () => {
      const ctx = context();
      const fingerprint = 'k'.repeat(64);
      const resourceId = randomUUID();

      await service.acquireOrReplay(ctx, fingerprint);
      await prisma.$transaction(async (tx) => {
        await tx.post.create({
          data: { id: resourceId, title: 'x', content: 'y' },
        });
        await service.finalize(ctx.key, outcome(resourceId), tx);
      });

      const stored = await prisma.idempotencyRequest.findUniqueOrThrow({
        where: { key: ctx.key },
      });
      expect(stored.state).toBe('FINALIZED');
      const post = await prisma.post.findUnique({ where: { id: resourceId } });
      expect(post).not.toBeNull();

      await prisma.post.deleteMany({ where: { id: resourceId } });
    });

    it('a caller transaction rollback leaves the key reclaimable, not FINALIZED', async () => {
      const ctx = context();
      const fingerprint = 'l'.repeat(64);
      const resourceId = randomUUID();

      await service.acquireOrReplay(ctx, fingerprint);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.post.create({
            data: { id: resourceId, title: 'x', content: 'y' },
          });
          await service.finalize(ctx.key, outcome(resourceId), tx);
          throw new Error('simulated failure after domain writes');
        }),
      ).rejects.toThrow('simulated failure after domain writes');

      const stored = await prisma.idempotencyRequest.findUniqueOrThrow({
        where: { key: ctx.key },
      });
      expect(stored.state).toBe('IN_PROGRESS');
      const post = await prisma.post.findUnique({ where: { id: resourceId } });
      expect(post).toBeNull();
    });
  });
});
