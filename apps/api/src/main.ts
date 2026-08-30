import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EnvironmentConfigurationService } from '@posts-media/configuration';

import { ApiModule } from './api.module';

export async function bootstrap(
  options?: NestApplicationOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(ApiModule, options);
  const { app: applicationConfiguration } = app.get(
    EnvironmentConfigurationService,
  ).values;

  app.setGlobalPrefix(applicationConfiguration.apiPrefix);
  await app.listen(applicationConfiguration.port);
  return app;
}

if (require.main === module) {
  void bootstrap();
}
