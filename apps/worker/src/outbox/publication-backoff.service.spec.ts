import { PublicationBackoffService } from './publication-backoff.service';

describe('PublicationBackoffService', () => {
  it('uses capped exponential delay with bounded jitter', () => {
    const service = new PublicationBackoffService();

    expect(service.delayMs(1, 60, 0)).toBe(1000);
    expect(service.delayMs(2, 60, 1)).toBe(2500);
    expect(service.delayMs(20, 2, 1)).toBe(2000);
  });
});
