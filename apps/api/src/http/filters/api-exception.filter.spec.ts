import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainError } from '@posts-media/domain';
import { MulterError } from 'multer';
import * as request from 'supertest';

import { RequestIdMiddleware } from '../middleware/request-id.middleware';
import { ApiExceptionFilter } from './api-exception.filter';

@Controller('probe')
class ProbeController {
  @Get('domain-error')
  domainError(): never {
    throw new DomainError(
      'POST_NOT_FOUND',
      'The requested post does not exist.',
      404,
    );
  }

  @Get('multer-error')
  multerError(): never {
    throw new MulterError('LIMIT_FILE_SIZE', 'media');
  }

  @Get('multer-unexpected-file')
  multerUnexpectedFile(): never {
    throw new MulterError('LIMIT_UNEXPECTED_FILE', 'media');
  }

  @Get('unexpected')
  unexpected(): never {
    throw new Error('Internal detail: /var/secret/credentials.txt leaked');
  }

  @Get('idempotency-in-progress')
  idempotencyInProgress(): never {
    throw new DomainError(
      'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      'A request with this Idempotency-Key is already being processed.',
      409,
      { retryAfterSeconds: 2 },
    );
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('ApiExceptionFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(new RequestIdMiddleware().use);
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serializes a DomainError with its own stable code, status, and a requestId', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/domain-error',
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'POST_NOT_FOUND',
      message: 'The requested post does not exist.',
    });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.body).not.toHaveProperty('stack');
  });

  it('maps a Multer file-size limit error to FILE_TRANSPORT_SIZE_EXCEEDED', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/multer-error',
    );

    expect(response.status).toBe(413);
    expect(response.body.code).toBe('FILE_TRANSPORT_SIZE_EXCEEDED');
  });

  it('maps a Multer unexpected-file error to UNEXPECTED_FILE_FIELD', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/multer-unexpected-file',
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('UNEXPECTED_FILE_FIELD');
  });

  it('sanitizes an unexpected error into a generic message with no leaked details', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/unexpected',
    );

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('/var/secret');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('sets a Retry-After header for IDEMPOTENCY_REQUEST_IN_PROGRESS', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/idempotency-in-progress',
    );

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('IDEMPOTENCY_REQUEST_IN_PROGRESS');
    expect(response.headers['retry-after']).toBe('2');
  });

  it('does not set Retry-After for other error codes', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/domain-error',
    );

    expect(response.headers['retry-after']).toBeUndefined();
  });

  it('always returns the X-Request-Id header alongside the error body', async () => {
    const response = await request(app.getHttpServer()).get(
      '/probe/domain-error',
    );

    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });
});
