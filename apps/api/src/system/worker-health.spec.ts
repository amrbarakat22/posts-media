import { classifyWorkerHeartbeat } from './worker-health';

describe('classifyWorkerHeartbeat', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('classifies missing, fresh, and stale heartbeats', () => {
    expect(classifyWorkerHeartbeat(null, now, 30)).toBe('MISSING');
    expect(
      classifyWorkerHeartbeat(new Date('2026-08-31T11:59:31.000Z'), now, 30),
    ).toBe('FRESH');
    expect(
      classifyWorkerHeartbeat(new Date('2026-08-31T11:59:29.000Z'), now, 30),
    ).toBe('STALE');
  });
});
