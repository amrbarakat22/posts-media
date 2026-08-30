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
    await withEnvironment(validEnvironment(), async () => {
      const applicationContext = await bootstrap({ logger: false });
      await applicationContext.close();
    });
  });
});
