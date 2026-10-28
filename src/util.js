import crypto from 'node:crypto';
import path from 'node:path';

const MIME = {
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  ts: 'text/plain; charset=utf-8',
  py: 'text/plain; charset=utf-8',
  go: 'text/plain; charset=utf-8',
  rs: 'text/plain; charset=utf-8',
  c: 'text/plain; charset=utf-8',
  h: 'text/plain; charset=utf-8',
  cpp: 'text/plain; charset=utf-8',
  java: 'text/plain; charset=utf-8',
  sh: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  apk: 'application/vnd.android.package-archive',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  woff2: 'font/woff2',
  woff: 'font/woff',
};

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']);
const VIDEO = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi']);
const AUDIO = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac']);
const TEXT = new Set(['txt', 'md', 'log', 'csv', 'json', 'xml', 'yml', 'yaml', 'html', 'css', 'js', 'ts', 'py', 'go', 'rs', 'c', 'h', 'cpp', 'java', 'sh', 'conf', 'ini', 'env']);

export function ext(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function mimeOf(name) {
  return MIME[ext(name)] || 'application/octet-stream';
}

/** Coarse kind drives the icon and the inline preview component. */
export function kindOf(name) {
  const e = ext(name);
  if (IMAGE.has(e)) return 'image';
  if (VIDEO.has(e)) return 'video';
  if (AUDIO.has(e)) return 'audio';
  if (TEXT.has(e)) return 'text';
  if (e === 'pdf') return 'pdf';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(e)) return 'archive';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(e)) return 'doc';
  return 'file';
}

export function humanSize(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function randomId(n = 16) {
  return crypto.randomBytes(n).toString('base64url');
}

/** Normalise a client-supplied relative path and guarantee it stays inside root. */
export function safeRel(input) {
  if (typeof input !== 'string') throw Object.assign(new Error('无效路径'), { status: 400 });
  let rel = input.replace(/\\/g, '/').replace(/^\/+/, '');
  rel = path.posix.normalize(rel);
  if (rel === '.' || rel === '') return '';
  const parts = rel.split('/');
  if (parts.some((p) => p === '..' || p === '')) {
    throw Object.assign(new Error('路径不合法'), { status: 400 });
  }
  if (parts.some((p) => p.startsWith('.lanshare'))) {
    throw Object.assign(new Error('路径不可访问'), { status: 403 });
  }
  return parts.join('/');
}

export function sanitizeName(name) {
  if (typeof name !== 'string') throw Object.assign(new Error('文件名无效'), { status: 400 });
  const clean = name.replace(/[/\\]/g, '_').replace(/[\u0000-\u001f]/g, '').trim();
  if (!clean || clean === '.' || clean === '..' || /^\.+$/.test(clean)) {
    throw Object.assign(new Error('文件名无效'), { status: 400 });
  }
  if (clean.startsWith('.lanshare')) {
    throw Object.assign(new Error('该名称不可用'), { status: 400 });
  }
  if (clean.length > 200) throw Object.assign(new Error('文件名过长'), { status: 400 });
  return clean;
}

/** Pick a non-colliding name: "report.pdf" -> "report (1).pdf". */
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const i = name.lastIndexOf('.');
  const stem = i > 0 ? name.slice(0, i) : name;
  const suffix = i > 0 ? name.slice(i) : '';
  for (let n = 1; n < 10000; n++) {
    const candidate = `${stem} (${n})${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${randomId(4)}${suffix}`;
}

export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function fail(res, status, message) {
  json(res, status, { error: message });
}

export async function readJson(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 格式错误'), { status: 400 });
  }
}

export function contentDisposition(name, inline = false) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
