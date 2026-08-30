import { Test } from '@nestjs/testing';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

import {
  validEnvironment,
  withEnvironment,
} from '../../../test/support/environment';
import { ApiModule } from './api.module';

describe('ApiModule configuration startup', () => {
  it('rejects invalid environment while creating the real Nest module', async () => {
    await withEnvironment({ NODE_ENV: 'unsupported' }, async () => {
      await expect(
        Test.createTestingModule({ imports: [ApiModule] }).compile(),
      ).rejects.toThrow('NODE_ENV');
    });
  });

  it('provides typed API port and prefix from the validated environment', async () => {
    await withEnvironment(
      validEnvironment({ PORT: '3101', API_PREFIX: 'typed-api' }),
      async () => {
        const module = await Test.createTestingModule({
          imports: [ApiModule],
        }).compile();

        try {
          expect(
            module.get(EnvironmentConfigurationService).values.app,
          ).toEqual(
            expect.objectContaining({ port: 3101, apiPrefix: 'typed-api' }),
          );
        } finally {
          await module.close();
        }
      },
    );
  });
});
