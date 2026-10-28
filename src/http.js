import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from './config.js';
import { fail, mimeOf, contentDisposition } from './util.js';

export { fail };

/** Rewrite relative module imports with a content hash, so caches can never mix versions. */
function stampModules(source, abs, dir) {
  return source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (m, a, spec, b) => {
    const target = path.resolve(dir, spec);
    let stamp = '';
    try {
      const st = fs.statSync(target);
      stamp = st.mtimeMs.toString(36);
    } catch {}
    return `${a}${spec}?v=${stamp}${b}`;
  });
}

export function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`;
  const abs = path.resolve(PUBLIC_DIR, rel);
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) {
    return fail(res, 403, '禁止访问');
  }
  let info;
  try {
    info = fs.statSync(abs);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    res.end();
    return true;
  }
  const ext = path.extname(abs);
  const type = ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.js' ? 'text/javascript; charset=utf-8'
    : ext === '.json' ? 'application/json; charset=utf-8'
    : ext === '.svg' ? 'image/svg+xml'
    : ext === '.woff2' ? 'font/woff2'
    : ext === '.png' ? 'image/png'
    : ext === '.ico' ? 'image/x-icon'
    : mimeOf(abs);
  const immutable = /\/fonts\//.test(abs);

  if (ext === '.html') {
    const html = fs.readFileSync(abs, 'utf8').replace(
      /(src|href)="(\/(?:js|css)\/[^"?]+)"/g,
      (m, attr, url) => {
        try {
          const st = fs.statSync(path.resolve(PUBLIC_DIR, `.${url}`));
          return `${attr}="${url}?v=${st.mtimeMs.toString(36)}"`;
        } catch {
          return m;
        }
      },
    );
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, {
      'content-type': type,
      'content-length': buf.length,
      'cache-control': 'no-cache',
      etag,
    });
    return res.end(buf);
  }

  if (ext === '.js' && abs.includes(`${path.sep}js${path.sep}`)) {
    const buf = Buffer.from(stampModules(fs.readFileSync(abs, 'utf8'), abs, path.dirname(abs)), 'utf8');
    res.writeHead(200, {
      'content-type': type,
      'content-length': buf.length,
      'cache-control': 'no-cache',
      etag,
    });
    return res.end(buf);
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=604800' : 'no-cache',
    etag,
  });

  fs.createReadStream(abs).pipe(res);
  return true;
}

/** Stream a file with HTTP Range support (seek/scrub for video, resumable downloads). */
export function sendFile(req, res, abs, { name, inline = false, mime, cache } = {}) {
  let info;
  try {
    info = fs.statSync(abs);
  } catch {
    return fail(res, 404, '文件不存在');
  }
  if (info.isDirectory()) return fail(res, 400, '目标是目录');

  const size = info.size;
  const type = mime || mimeOf(name || abs);
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': cache || 'private, max-age=0, must-revalidate',
    'last-modified': new Date(info.mtimeMs).toUTCString(),
    'etag': `W/"${size.toString(16)}-${info.mtimeMs.toString(16)}"`,
  };
  if (name) headers['content-disposition'] = contentDisposition(name, inline);

  const range = req.headers.range;
  let start = 0;
  let end = size - 1;
  let status = 200;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const [, rawStart, rawEnd] = match;
      if (rawStart === '' && rawEnd === '') {
        res.writeHead(416, { 'content-range': `bytes */${size}` });
        return res.end();
      }
      if (rawStart === '') {
        // suffix range: last N bytes
        const suffix = Number(rawEnd);
        start = Math.max(0, size - suffix);
        end = size - 1;
      } else {
        start = Number(rawStart);
        end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
      }
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes' });
        return res.end();
      }
      status = 206;
      headers['content-range'] = `bytes ${start}-${end}/${size}`;
    }
  }

  if (size === 0) {
    res.writeHead(200, { ...headers, 'content-length': 0 });
    return res.end();
  }

  headers['content-length'] = end - start + 1;
  res.writeHead(status, headers);

  if (req.method === 'HEAD') return res.end();

  const stream = fs.createReadStream(abs, { start, end, highWaterMark: 256 * 1024 });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/** Map an index into the chunk plan for a resumable upload. */
export function chunkBounds(index, received, size, chunkSize) {
  const start = index * chunkSize;
  const end = Math.min(start + chunkSize, size) - 1;
  return { start, end };
}

export function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,range,authorization');
  res.setHeader('access-control-expose-headers', 'content-range,content-length,accept-ranges');
}
