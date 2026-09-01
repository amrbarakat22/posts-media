import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { EnvironmentConfigurationService } from '@posts-media/configuration';
import { DomainError } from '@posts-media/domain';
import type { ValidationError } from 'class-validator';
import helmet from 'helmet';
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
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'http://127.0.0.1:9000'],
          mediaSrc: ["'self'", 'blob:', 'http://127.0.0.1:9000'],
          connectSrc: ["'self'", 'http://127.0.0.1:9000'],
        },
      },
    }),
  );
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
  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Posts & Media API')
      .setDescription('Local Posts CRUD and mixed-media processing API')
      .setVersion('1.0')
      .addTag('posts')
      .addTag('media')
      .addTag('system')
      .build(),
  );
  SwaggerModule.setup('docs', app, swaggerDocument, {
    useGlobalPrefix: true,
    jsonDocumentUrl: 'docs-json',
  });
  await app.listen(applicationConfiguration.port);
  return app;
}

if (require.main === module) {
  void bootstrap();
}
