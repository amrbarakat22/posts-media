/* global crypto, document, FormData, setInterval, URLSearchParams */
import { element, request } from './api.js';
import { upload } from './uploads.js';
const byId = (id) => document.getElementById(id);
const state = { page: 1, pages: 1, active: false };
const show = (result) => {
  byId('json-output').textContent = JSON.stringify(result.body, null, 2);
  byId('request-id').textContent = result.requestId
    ? `Request ID: ${result.requestId}`
    : '';
};
const fail = (error) =>
  show({
    body: error.body || { message: error.message },
    requestId: error.requestId,
  });
const mediaCard = (media) => {
  const card = element('article', undefined, 'media-card');
  card.append(element('h4', `${media.mediaType} · ${media.processingStatus}`));
  const progress = document.createElement('progress');
  progress.max = 100;
  progress.value = media.progress;
  card.append(progress);
  const actions = element('div', undefined, 'actions');
  const inspect = element('button', 'Inspect');
  inspect.type = 'button';
  inspect.onclick = () => request(`/api/media/${media.id}`).then(show, fail);
  actions.append(inspect);
  if (media.processingStatus === 'COMPLETED') {
    const access = element('button', 'Preview');
    access.type = 'button';
    access.onclick = () =>
      request(`/api/media/${media.id}/access`).then((result) => {
        show(result);
        const urls = Object.values(result.body.variants);
        const source = urls[0] || result.body.original;
        const preview = document.createElement(
          media.mediaType === 'IMAGE'
            ? 'img'
            : media.mediaType === 'AUDIO'
              ? 'audio'
              : 'video',
        );
        preview.src = source;
        preview.controls = media.mediaType !== 'IMAGE';
        preview.alt =
          media.mediaType === 'IMAGE' ? 'Processed media preview' : '';
        card.append(preview);
      }, fail);
    actions.append(access);
  }
  if (media.processingStatus === 'FAILED') {
    const retry = element('button', 'Retry');
    retry.type = 'button';
    retry.onclick = () =>
      request(`/api/media/${media.id}/retry`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      }).then((value) => {
        show(value);
        void refresh();
      }, fail);
    actions.append(retry);
  }
  if (
    media.processingStatus === 'PENDING' ||
    media.processingStatus === 'PROCESSING'
  )
    state.active = true;
  card.append(actions);
  return card;
};
const postCard = (post) => {
  const card = element('article', undefined, 'post-card');
  card.append(
    element('h3', post.title),
    element('p', post.content),
    element('p', `${post.aggregateStatus} · ${post.mediaCount} media`),
  );
  const grid = element('div', undefined, 'media-grid');
  post.media.forEach((media) => grid.append(mediaCard(media)));
  card.append(grid);
  const actions = element('div', undefined, 'actions');
  const toggle = element('button', post.deletedAt ? 'Restore' : 'Delete');
  toggle.type = 'button';
  toggle.onclick = () =>
    request(`/api/posts/${post.id}${post.deletedAt ? '/restore' : ''}`, {
      method: post.deletedAt ? 'POST' : 'DELETE',
    }).then((value) => {
      show(value);
      void refresh();
    }, fail);
  const files = document.createElement('input');
  files.type = 'file';
  files.multiple = true;
  files.setAttribute('aria-label', `Add media to ${post.title}`);
  files.onchange = () => {
    const data = new FormData();
    [...files.files].forEach((file) => data.append('media', file));
    upload(
      `/api/posts/${post.id}/media`,
      data,
      crypto.randomUUID(),
      () => {},
    ).then((value) => {
      show(value);
      void refresh();
    }, fail);
  };
  actions.append(toggle, files);
  card.append(actions);
  return card;
};
async function refresh() {
  const form = byId('filters-form');
  const params = new URLSearchParams(new FormData(form));
  params.set('page', String(state.page));
  if (!form.includeDeleted.checked) params.delete('includeDeleted');
  [...params].forEach(([key, value]) => {
    if (!value) params.delete(key);
  });
  try {
    const result = await request(`/api/posts?${params}`);
    show(result);
    state.pages = result.body.pagination.totalPages || 1;
    state.active = false;
    const output = byId('posts-output');
    output.replaceChildren();
    result.body.data.forEach((post) => output.append(postCard(post)));
    byId('page-label').textContent = `Page ${state.page} of ${state.pages}`;
    byId('previous').disabled = state.page <= 1;
    byId('next').disabled = state.page >= state.pages;
  } catch (error) {
    fail(error);
  }
}
byId('filters-form').onsubmit = (event) => {
  event.preventDefault();
  state.page = 1;
  void refresh();
};
byId('previous').onclick = () => {
  state.page -= 1;
  void refresh();
};
byId('next').onclick = () => {
  state.page += 1;
  void refresh();
};
byId('create-form').onsubmit = async (event) => {
  event.preventDefault();
  const progress = byId('upload-progress');
  progress.hidden = false;
  try {
    const result = await upload(
      '/api/posts',
      new FormData(event.currentTarget),
      crypto.randomUUID(),
      (value) => {
        progress.value = value;
      },
    );
    show(result);
    event.currentTarget.reset();
    await refresh();
  } catch (error) {
    fail(error);
  } finally {
    progress.hidden = true;
  }
};
async function diagnostics() {
  try {
    const [ready, detail] = await Promise.all([
      request('/api/system/ready'),
      request('/api/system/diagnostics'),
    ]);
    byId('system-status').textContent = ready.body.status;
    byId('diagnostics').textContent = JSON.stringify(detail.body, null, 2);
  } catch (error) {
    byId('system-status').textContent = 'NOT READY';
    fail(error);
  }
}
setInterval(() => {
  void diagnostics();
  if (state.active) void refresh();
}, 2000);
void diagnostics();
void refresh();
