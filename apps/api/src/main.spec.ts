import { createServer } from 'node:net';
import { get as httpGet } from 'node:http';

import {
  validEnvironment,
  withEnvironment,
} from '../../../test/support/environment';
import { bootstrap } from './main';

const getJson = (
  url: string,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}> =>
  new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          });
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    }).on('error', reject);
  });

const getText = (
  url: string,
): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> =>
  new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      response.on('error', reject);
    }).on('error', reject);
  });

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

  it('assigns a request id and returns the stable error shape for an unknown route', async () => {
    const port = await availablePort();
    await withEnvironment(
      validEnvironment({ PORT: String(port) }),
      async () => {
        const application = await bootstrap({ logger: false });
        try {
          const response = await getJson(
            `http://127.0.0.1:${port}/api/does-not-exist`,
          );

          expect(response.status).toBe(404);
          expect(response.headers['x-request-id']).toEqual(expect.any(String));
          expect(response.body).toMatchObject({
            statusCode: 404,
            code: 'INTERNAL_ERROR',
            requestId: response.headers['x-request-id'],
          });
          expect(response.body).not.toHaveProperty('stack');
        } finally {
          await application.close();
        }
      },
    );
  });

  it('serves the static dashboard and documents every required route', async () => {
    const port = await availablePort();
    await withEnvironment(
      validEnvironment({ PORT: String(port) }),
      async () => {
        const application = await bootstrap({ logger: false });
        try {
          const [html, css, javascript, documentResponse] = await Promise.all([
            getText(`http://127.0.0.1:${port}/`),
            getText(`http://127.0.0.1:${port}/css/styles.css`),
            getText(`http://127.0.0.1:${port}/js/app.js`),
            getJson(`http://127.0.0.1:${port}/api/docs-json`),
          ]);
          expect(html).toMatchObject({ status: 200 });
          expect(html.body).toContain('Posts &amp; Media');
          expect(html.headers['content-security-policy']).toContain(
            "default-src 'self'",
          );
          expect(html.headers['x-content-type-options']).toBe('nosniff');
          expect(css.status).toBe(200);
          expect(javascript.status).toBe(200);
          const paths = (
            documentResponse.body as { paths: Record<string, unknown> }
          ).paths;
          expect(Object.keys(paths)).toEqual(
            expect.arrayContaining([
              '/api/posts',
              '/api/posts/{postId}',
              '/api/posts/{postId}/media',
              '/api/posts/{postId}/restore',
              '/api/media/{mediaId}',
              '/api/media/{mediaId}/status',
              '/api/media/{mediaId}/access',
              '/api/media/{mediaId}/retry',
              '/api/system/live',
              '/api/system/ready',
              '/api/system/diagnostics',
            ]),
          );
        } finally {
          await application.close();
        }
      },
    );
  });
});
