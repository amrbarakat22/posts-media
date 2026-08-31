/* global document, fetch */

export const request = async (path, options = {}) => {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  const requestId = response.headers.get('x-request-id');
  if (!response.ok)
    throw Object.assign(new Error(body.message || `HTTP ${response.status}`), {
      body,
      requestId,
    });
  return { body, requestId };
};
export const element = (name, text, className) => {
  const node = document.createElement(name);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
