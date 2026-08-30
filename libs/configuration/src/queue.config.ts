import type { EnvironmentConfiguration } from './environment.schema';

export const queueConfig = (configuration: EnvironmentConfiguration) => ({
  redis: configuration.redis,
  outbox: configuration.outbox,
  worker: configuration.worker,
});
