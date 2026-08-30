import { Test } from '@nestjs/testing';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

import {
  validEnvironment,
  withEnvironment,
} from '../../../test/support/environment';
import { WorkerModule } from './worker.module';

describe('WorkerModule configuration startup', () => {
  it('rejects invalid environment while creating the real Nest module', async () => {
    await withEnvironment({ NODE_ENV: 'unsupported' }, async () => {
      await expect(
        Test.createTestingModule({ imports: [WorkerModule] }).compile(),
      ).rejects.toThrow('NODE_ENV');
    });
  });

  it('provides the validated worker configuration', async () => {
    await withEnvironment(
      validEnvironment({ IMAGE_WORKER_CONCURRENCY: '7' }),
      async () => {
        const module = await Test.createTestingModule({
          imports: [WorkerModule],
        }).compile();

        try {
          expect(
            module.get(EnvironmentConfigurationService).values.worker
              .imageConcurrency,
          ).toBe(7);
        } finally {
          await module.close();
        }
      },
    );
  });
});
