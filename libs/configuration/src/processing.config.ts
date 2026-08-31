import type { EnvironmentConfiguration } from './environment.schema';

export const processingConfig = (configuration: EnvironmentConfiguration) =>
  configuration.processing;

/** Runtime media tool names are fixed, non-shell commands verified by scripts. */
export const mediaToolConfig = Object.freeze({
  ffprobeBinary: 'ffprobe',
});
