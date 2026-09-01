import {
  validEnvironment,
  withEnvironment,
} from '../../../test/support/environment';
import { bootstrap } from './main';

describe('worker bootstrap', () => {
  it('rejects an invalid environment before starting the application context', async () => {
    await withEnvironment({ NODE_ENV: 'unsupported' }, async () => {
      await expect(
        bootstrap({ abortOnError: false, logger: false }),
      ).rejects.toThrow('NODE_ENV');
    });
  });

  it('starts with validated worker configuration', async () => {
    await withEnvironment(
      validEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://posts:posts@postgres:5432/posts_media_test',
        REDIS_HOST: 'redis',
        MINIO_ENDPOINT: 'minio',
      }),
      async () => {
        const signalListeners = process.listenerCount('SIGTERM');
        const applicationContext = await bootstrap({ logger: false });
        try {
          expect(process.listenerCount('SIGTERM')).toBeGreaterThan(
            signalListeners,
          );
        } finally {
          await applicationContext.close();
        }
        expect(process.listenerCount('SIGTERM')).toBe(signalListeners);
      },
    );
  });
});
