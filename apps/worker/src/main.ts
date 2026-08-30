import type {
  INestApplicationContext,
  NestApplicationOptions,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

export async function bootstrap(
  options?: NestApplicationOptions,
): Promise<INestApplicationContext> {
  return NestFactory.createApplicationContext(WorkerModule, options);
}

if (require.main === module) {
  void bootstrap();
}
