async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const init = { method, headers: { ...headers }, signal };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof FormData || body instanceof ArrayBuffer) {
      init.body = body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {}
    throw Object.assign(new Error(message), { status: res.status });
  }
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) return res.json();
  return res;
}

export const api = {
  list: (dir = '') => request(`/api/list?dir=${encodeURIComponent(dir)}`),
  system: () => request('/api/system'),
  disk: () => request('/api/disk'),
  mkdir: (dir, name) => request('/api/mkdir', { method: 'POST', body: { dir, name } }),
  rename: (path, name) => request('/api/rename', { method: 'POST', body: { path, name } }),
  remove: (paths, trash = true) => request('/api/delete', { method: 'POST', body: { paths, trash } }),
  move: (path, dir) => request('/api/move', { method: 'POST', body: { path, dir } }),
  copy: (path, dir) => request('/api/copy', { method: 'POST', body: { path, dir } }),
  manifest: (paths) => request('/api/manifest', { method: 'POST', body: { paths } }),

  initUpload: (payload) => request('/api/upload/init', { method: 'POST', body: payload }),
  uploadChunk: (id, index, blob, signal) =>
    request(`/api/upload/${id}/chunk?index=${index}`, { method: 'PUT', body: blob, signal }),
  completeUpload: (id) => request(`/api/upload/${id}/complete`, { method: 'POST', body: {} }),
  cancelUpload: (id) => request(`/api/upload/${id}`, { method: 'DELETE' }),

  shares: () => request('/api/shares'),
  createShare: (payload) => request('/api/shares', { method: 'POST', body: payload }),
  deleteShare: (id) => request(`/api/shares/${id}`, { method: 'DELETE' }),

  spaces: () => request('/api/spaces'),
  createSpace: (payload) => request('/api/spaces', { method: 'POST', body: payload }),
  updateSpace: (id, payload) => request(`/api/spaces/${id}`, { method: 'PATCH', body: payload }),
  deleteSpace: (id) => request(`/api/spaces/${id}`, { method: 'DELETE' }),

  shareInfo: (id) => request(`/api/s/${id}`),
  shareList: (id, sub = '') => request(`/api/s/${id}/list?path=${encodeURIComponent(sub)}`),
  shareContentUrl: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return `/api/s/${id}/content${q ? `?${q}` : ''}`;
  },
  shareUploadUrl: (id, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return `/api/s/${id}/upload${q ? `?${q}` : ''}`;
  },

  /** Raw-body upload used by the public space page. */
  uploadToShare: (id, { path = '', name, file, onProgress, signal }) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/s/${id}/upload?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText || '{}'));
      } else {
        let message = `上传失败 (${xhr.status})`;
        try { message = JSON.parse(xhr.responseText).error || message; } catch {}
        reject(Object.assign(new Error(message), { status: xhr.status }));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('网络中断，上传失败')));
    xhr.addEventListener('abort', () => reject(Object.assign(new Error('已取消'), { name: 'AbortError' })));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  }),
};

export function downloadUrl(path, inline = false) {
  return `/api/download?path=${encodeURIComponent(path)}${inline ? '&inline=1' : ''}`;
}

export function previewUrl(path) {
  return `/api/file?path=${encodeURIComponent(path)}&inline=1`;
}

export function thumbUrl(path, w = 320) {
  return `/api/thumb?path=${encodeURIComponent(path)}&w=${w}`;
}

/** Trigger a browser download without leaving the page. */
export function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}
