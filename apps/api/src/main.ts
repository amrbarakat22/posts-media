import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import { DomainError } from '@posts-media/domain';
import type { ValidationError } from 'class-validator';
import { join } from 'node:path';

import { ApiModule } from './api.module';
import { ApiExceptionFilter } from './http/filters/api-exception.filter';

const flattenValidationMessages = (
  errors: ValidationError[],
  path: string[] = [],
): string[] =>
  errors.flatMap((error) => {
    const currentPath = [...path, error.property];
    const ownMessages = Object.values(error.constraints ?? {});
    const childMessages =
      error.children !== undefined && error.children.length > 0
        ? flattenValidationMessages(error.children, currentPath)
        : [];
    return [...ownMessages, ...childMessages];
  });

export async function bootstrap(
  options?: NestApplicationOptions,
): Promise<INestApplication> {
  const app = await NestFactory.create(ApiModule, options);
  (app as NestExpressApplication).useStaticAssets(
    join(process.cwd(), 'apps/api/public'),
  );
  const { app: applicationConfiguration } = app.get(
    EnvironmentConfigurationService,
  ).values;

  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new DomainError(
          'VALIDATION_FAILED',
          'The request body or query is invalid.',
          400,
          { violations: flattenValidationMessages(errors) },
        ),
    }),
  );
  app.setGlobalPrefix(applicationConfiguration.apiPrefix);
  await app.listen(applicationConfiguration.port);
  return app;
}

if (require.main === module) {
  void bootstrap();
}
