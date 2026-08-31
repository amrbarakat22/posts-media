/* global XMLHttpRequest */

export const upload = (path, data, key, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('Idempotency-Key', key);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      const body = JSON.parse(xhr.responseText || '{}');
      const result = { body, requestId: xhr.getResponseHeader('x-request-id') };
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else
        reject(
          Object.assign(
            new Error(body.message || `HTTP ${xhr.status}`),
            result,
          ),
        );
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.send(data);
  });
