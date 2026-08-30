import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const environmentExamplePath = join(process.cwd(), '.env.example');

export const validEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => {
  const entries = readFileSync(environmentExamplePath, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) {
        return [];
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) {
        throw new Error(`Invalid .env.example entry: ${trimmed}`);
      }

      return [
        [trimmed.slice(0, separatorIndex), trimmed.slice(separatorIndex + 1)],
      ];
    });

  return { ...Object.fromEntries(entries), ...overrides };
};

export const withEnvironment = async <T>(
  environment: NodeJS.ProcessEnv,
  callback: () => Promise<T>,
): Promise<T> => {
  const previous = process.env;
  process.env = { ...environment };
  try {
    return await callback();
  } finally {
    process.env = previous;
  }
};
