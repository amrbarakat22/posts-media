import { createServer } from 'node:net';

import {
  validEnvironment,
  withEnvironment,
} from '../../../test/support/environment';
import { bootstrap } from './main';

const availablePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Unable to resolve an ephemeral port'));
        return;
      }
      server.close((error) =>
        error === undefined ? resolve(address.port) : reject(error),
      );
    });
  });

describe('API bootstrap', () => {
  it('rejects an invalid environment before starting the HTTP server', async () => {
    await withEnvironment({ NODE_ENV: 'unsupported' }, async () => {
      await expect(
        bootstrap({ abortOnError: false, logger: false }),
      ).rejects.toThrow('NODE_ENV');
    });
  });

  it('starts on the validated typed port and exposes its typed configuration', async () => {
    const port = await availablePort();
    await withEnvironment(
      validEnvironment({ PORT: String(port) }),
      async () => {
        const application = await bootstrap({ logger: false });
        try {
          expect(await application.getUrl()).toBe(`http://[::1]:${port}`);
        } finally {
          await application.close();
        }
      },
    );
  });
});
