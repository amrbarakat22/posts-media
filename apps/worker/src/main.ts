import type {
  INestApplicationContext,
  NestApplicationOptions,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

export async function bootstrap(
  options?: NestApplicationOptions,
): Promise<INestApplicationContext> {
  const application = await NestFactory.createApplicationContext(
    WorkerModule,
    options,
  );
  application.enableShutdownHooks();
  return application;
}

if (require.main === module) {
  void bootstrap();
}
