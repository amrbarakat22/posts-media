import type { EnvironmentConfiguration } from './environment.schema';

export const appConfig = (configuration: EnvironmentConfiguration) =>
  configuration.app;
