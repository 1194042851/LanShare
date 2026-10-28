import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { PORT, HOST, DEVICE_NAME, STORAGE_ROOT, PUBLIC_DIR, usableLanAddresses } from './src/config.js';
import { initStorage, listDir, diskStats } from './src/storage.js';
import { serveStatic, fail, cors } from './src/http.js';
import { json, humanSize, safeRel } from './src/util.js';
import { addClient } from './src/events.js';
import * as files from './src/routes/files.js';
import * as upload from './src/routes/upload.js';
import * as share from './src/routes/share.js';
import { streamZip } from './src/zip.js';

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const regex = new RegExp(
    '^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$',
  );
  routes.push({ method, regex, keys, handler });
}

/* files */
route('GET', '/api/list', files.handleList);
route('GET', '/api/file', files.handleFile);
route('GET', '/api/thumb', files.handleThumb);
route('GET', '/api/download', files.handleFile);
route('POST', '/api/mkdir', files.handleMkdir);
route('POST', '/api/rename', files.handleRename);
route('POST', '/api/delete', files.handleDelete);
route('POST', '/api/move', files.handleMove);
route('POST', '/api/manifest', files.handleManifest);
route('POST', '/api/download-zip', files.handleDownloadZip);
route('GET', '/api/disk', files.handleDisk);

/* uploads */
route('POST', '/api/upload/init', upload.handleInit);
route('PUT', '/api/upload/:id/chunk', upload.handleChunk);
route('POST', '/api/upload/:id/complete', upload.handleComplete);
route('DELETE', '/api/upload/:id', upload.handleCancel);

/* shares */
route('POST', '/api/shares', share.handleCreateShare);
route('GET', '/api/shares', share.handleListShares);
route('DELETE', '/api/shares/:id', share.handleDeleteShare);
route('GET', '/api/s/:id', share.handleShareInfo);
route('GET', '/api/s/:id/list', share.handleShareList);
route('GET', '/api/s/:id/content', share.handleShareContent);
route('PUT', '/api/s/:id/upload', share.handleShareUpload);

/* shared spaces */
route('POST', '/api/spaces', share.handleCreateSpace);
route('GET', '/api/spaces', share.handleListSpaces);
route('PATCH', '/api/spaces/:id', share.handleUpdateSpace);
route('DELETE', '/api/spaces/:id', share.handleDeleteSpace);

/* system */
route('GET', '/api/system', share.handleSystem);
route('GET', '/api/events', (req, res) => { addClient(req, res); });

function notFound(res) {
  return fail(res, 404, '接口不存在');
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'local'}`);
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.regex.exec(url.pathname);
        if (!match) continue;
        const params = {};
        r.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]); });
        return await r.handler(req, res, url, params);
      }
      return notFound(res);
    }

    // Public share landing page and its helper asset.
    if (url.pathname.startsWith('/s/')) {
      if (serveStatic(req, res, '/share.html')) return;
      return fail(res, 404, '链接无效');
    }

    if (serveStatic(req, res, url.pathname)) return;

    // SPA-ish fallback: unknown non-API paths render the app shell.
    if (!path.extname(url.pathname)) {
      if (serveStatic(req, res, '/index.html')) return;
    }
    return notFound(res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[${req.method} ${url.pathname}]`, err);
    if (!res.headersSent) return fail(res, status, err.message || '服务器错误');
    res.destroy();
  } finally {
    if (process.env.LANSHARE_LOG === '1') {
      console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
});

server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

await initStorage();

server.listen(PORT, HOST, () => {
  const hosts = usableLanAddresses();
  console.log('');
  console.log(`  ${DEVICE_NAME} —— 局域网共享`);
  console.log(`  本地:   http://localhost:${PORT}`);
  for (const h of hosts) console.log(`  局域网: http://${h.address}:${PORT}   (${h.iface})`);
  console.log(`  存储:   ${STORAGE_ROOT}`);
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
