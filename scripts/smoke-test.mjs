/* global Blob, fetch, FormData, process, setTimeout */

import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { createTestMedia } from './create-test-media.mjs';

const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000/api';
const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  return body;
};
const eventually = async (mediaId) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const media = await call(`/media/${mediaId}/status`);
    if (media.processingStatus === 'COMPLETED') return media;
    if (media.processingStatus === 'FAILED')
      throw new Error(`${mediaId} failed: ${JSON.stringify(media.lastError)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${mediaId} did not reach a terminal state`);
};

const directory = await mkdtemp(join(tmpdir(), 'posts-media-smoke-'));
const fixtures = await createTestMedia(directory);
const createKey = randomUUID();
const createBody = JSON.stringify({
  title: `Smoke ${createKey}`,
  content: 'Full-stack smoke test',
});
const createOptions = {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'Idempotency-Key': createKey },
  body: createBody,
};
const post = await call('/posts', createOptions);
const replay = await call('/posts', createOptions);
if (replay.id !== post.id)
  throw new Error('Idempotency replay returned a different post');
const form = new FormData();
for (const [path, type] of [
  [fixtures.image, 'image/png'],
  [fixtures.audio, 'audio/wav'],
  [fixtures.video, 'video/mp4'],
])
  form.append(
    'media',
    new Blob([await readFile(path)], { type }),
    path.split('/').pop(),
  );
const added = await call(`/posts/${post.id}/media`, {
  method: 'POST',
  headers: { 'Idempotency-Key': randomUUID() },
  body: form,
});
const accepted = added.accepted ?? added.media ?? [];
if (accepted.length !== 3)
  throw new Error(`Expected 3 accepted media, got ${accepted.length}`);
for (const item of accepted) {
  const completed = await eventually(item.id);
  if (completed.variants.length === 0)
    throw new Error(`${item.id} has no variants`);
  const access = await call(`/media/${item.id}/access`);
  if (!access.original || Object.keys(access.variants).length === 0)
    throw new Error(`${item.id} has no access URLs`);
}
const listed = await call(`/posts?search=${encodeURIComponent(createKey)}`);
if (!listed.data.some((item) => item.id === post.id))
  throw new Error('Created post missing from filtered list');
await call(`/posts/${post.id}`, { method: 'DELETE' });
await call(`/posts/${post.id}/restore`, { method: 'POST' });
process.stdout.write(
  `Smoke passed for post ${post.id} and ${accepted.length} media\n`,
);
