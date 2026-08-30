import type { EnvironmentConfiguration } from './environment.schema';

export const storageConfig = (configuration: EnvironmentConfiguration) =>
  configuration.storage;
