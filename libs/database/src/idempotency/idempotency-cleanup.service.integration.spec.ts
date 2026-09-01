import { randomUUID } from 'node:crypto';

import { assertTestInfrastructure } from '../../../../test/support/test-infrastructure.guard';
import { IdempotencyCleanupService } from './idempotency-cleanup.service';
import { PrismaService } from '../prisma.service';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://posts:posts@postgres:5432/posts_media_test';
assertTestInfrastructure({ databaseUrl });

const prisma = new PrismaService(databaseUrl);
const cleanup = new IdempotencyCleanupService(prisma);

const createRow = async (expiresAt: Date, state: 'FINALIZED' | 'IN_PROGRESS') =>
  prisma.idempotencyRequest.create({
    data: {
      key: randomUUID(),
      operation: 'CREATE_POST',
      method: 'POST',
      routeTemplate: '/api/posts',
      requestFingerprint: 'a'.repeat(64),
      state,
      expiresAt,
    },
  });

describe('IdempotencyCleanupService (integration)', () => {
  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  afterEach(async () => {
    await prisma.idempotencyRequest.deleteMany();
  });

  it('removes only rows past their expiresAt, regardless of state', async () => {
    const expiredFinalized = await createRow(
      new Date(Date.now() - 1000),
      'FINALIZED',
    );
    const expiredInProgress = await createRow(
      new Date(Date.now() - 1000),
      'IN_PROGRESS',
    );
    const stillValid = await createRow(
      new Date(Date.now() + 3_600_000),
      'FINALIZED',
    );

    const removed = await cleanup.removeExpired();

    expect(removed).toBe(2);
    const remaining = await prisma.idempotencyRequest.findMany();
    expect(remaining.map((row) => row.id)).toEqual([stillValid.id]);
    expect(
      remaining.find((row) => row.id === expiredFinalized.id),
    ).toBeUndefined();
    expect(
      remaining.find((row) => row.id === expiredInProgress.id),
    ).toBeUndefined();
  });

  it('returns 0 and removes nothing when no rows are expired', async () => {
    await createRow(new Date(Date.now() + 3_600_000), 'FINALIZED');

    expect(await cleanup.removeExpired()).toBe(0);
    expect(await prisma.idempotencyRequest.count()).toBe(1);
  });
});
