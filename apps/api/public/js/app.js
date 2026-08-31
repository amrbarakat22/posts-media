/* global document, fetch, FormData, crypto */

const byId = (id) => document.getElementById(id);
const json = async (response) => {
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.message || body.error?.message || `HTTP ${response.status}`,
    );
  return body;
};

const refresh = async () => {
  const output = byId('posts-output');
  try {
    const [posts, diagnostics] = await Promise.all([
      fetch('/api/posts').then(json),
      fetch('/api/system/diagnostics').then(json),
    ]);
    output.textContent = JSON.stringify({ posts, diagnostics }, null, 2);
  } catch (error) {
    output.textContent =
      error instanceof Error ? error.message : 'Request failed';
  }
};

byId('refresh').addEventListener('click', refresh);
byId('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const response = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: data,
  });
  await json(response);
  form.reset();
  await refresh();
});

fetch('/api/system/live')
  .then(json)
  .then(() => {
    byId('system-status').textContent = 'API is live';
  })
  .catch(() => {
    byId('system-status').textContent = 'API status unavailable';
  });
refresh();
