export const classifyWorkerHeartbeat = (
  heartbeatAt: Date | null,
  now: Date,
  staleAfterSeconds: number,
): 'MISSING' | 'FRESH' | 'STALE' => {
  if (heartbeatAt === null) return 'MISSING';
  return now.getTime() - heartbeatAt.getTime() <= staleAfterSeconds * 1000
    ? 'FRESH'
    : 'STALE';
};
