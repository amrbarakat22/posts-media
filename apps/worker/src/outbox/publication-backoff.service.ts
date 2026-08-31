import { Injectable } from '@nestjs/common';

@Injectable()
export class PublicationBackoffService {
  public delayMs(
    nextAttemptNumber: number,
    maxRetryDelaySeconds: number,
    random = Math.random(),
  ): number {
    const cappedBase = Math.min(
      1000 * 2 ** Math.max(0, nextAttemptNumber - 1),
      maxRetryDelaySeconds * 1000,
    );
    const jitter = Math.min(0.25, Math.max(0, random)) * cappedBase;
    return Math.min(
      maxRetryDelaySeconds * 1000,
      Math.ceil(cappedBase + jitter),
    );
  }
}
