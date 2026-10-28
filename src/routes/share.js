import path from 'node:path';
import { PORT, DEVICE_NAME, usableLanAddresses, primaryLanAddress } from '../config.js';
import { stmt, db } from '../db.js';
import { absPath, statRel, listDir, diskStats, walk } from '../storage.js';
import { json, fail, readJson, safeRel, randomId } from '../util.js';
import { sendFile } from '../http.js';
import { streamZip } from '../zip.js';
import { broadcast, clientCount } from '../events.js';

/**
 * Always advertise a LAN-reachable address. Browsing from 127.0.0.1/localhost
 * would otherwise produce share links that only work on this machine.
 */
export function baseUrlOf(req) {
  const host = String(req.headers.host || '');
  const hostname = host.replace(/:\d+$/, '');
  const isLoopback = !hostname
    || hostname === 'localhost'
    || hostname === '[::1]'
    || /^127\./.test(hostname);

  if (!isLoopback) return `http://${host}`;

  const lan = primaryLanAddress();
  if (lan) return `http://${lan.address}:${PORT}`;
  return `http://${host || `localhost:${PORT}`}`;
}

function sharePayload(row, base) {
  return {
    id: row.id,
    rel: row.rel,
    kind: row.kind,
    name: path.posix.basename(row.rel),
    createdAt: row.created_at,
    url: `${base}/s/${row.id}`,
  };
}

export async function handleCreateShare(req, res) {
  const body = await readJson(req);
  const rel = safeRel(body.path);
  if (!rel) return fail(res, 400, '不能分享根目录');
  const info = await statRel(rel);
  const id = randomId(7);
  stmt.insertShare.run(id, rel, info.isDirectory() ? 'dir' : 'file', Date.now());
  broadcast('shares');
  return json(res, 201, sharePayload(stmt.getShare.get(id), baseUrlOf(req)));
}

export async function handleListShares(req, res) {
  const base = baseUrlOf(req);
  const rows = [];
  for (const row of stmt.allShares.all()) {
    try {
      await statRel(row.rel);
      rows.push(row);
    } catch {}
  }
  return json(res, 200, { shares: rows.map((row) => sharePayload(row, base)) });
}

export async function handleDeleteShare(req, res, url, { id }) {
  stmt.deleteShare.run(id);
  broadcast('shares');
  return json(res, 200, { ok: true });
}

export async function handleShareInfo(req, res, url, { id }) {
  const row = stmt.getShare.get(id);
  if (!row) return fail(res, 404, '链接无效或已失效');
  let info;
  try {
    info = await statRel(row.rel);
  } catch {
    return fail(res, 404, '分享的文件已被删除');
  }
  return json(res, 200, {
    id: row.id,
    kind: row.kind,
    name: path.posix.basename(row.rel),
    size: row.kind === 'file' ? info.size : null,
    mtime: Math.floor(info.mtimeMs),
    device: DEVICE_NAME,
  });
}

export async function handleShareContent(req, res, url, { id }) {
  const row = stmt.getShare.get(id);
  if (!row) return fail(res, 404, '链接无效或已失效');

  if (row.kind === 'file') {
    return sendFile(req, res, absPath(row.rel), {
      name: path.posix.basename(row.rel),
      inline: url.searchParams.get('inline') === '1',
    });
  }

  // Directory share: list entries, or fetch one nested file.
  const sub = safeRel(url.searchParams.get('path') || '');
  if (sub) {
    const target = `${row.rel}/${sub}`;
    const info = await statRel(target);
    if (info.isDirectory()) return fail(res, 400, '目录请整体下载');
    return sendFile(req, res, absPath(target), {
      name: path.posix.basename(target),
      inline: url.searchParams.get('inline') === '1',
    });
  }

  const entries = [];
  for (const file of await walk(row.rel)) {
    entries.push({ abs: absPath(file), name: file.slice(row.rel.length + 1) });
  }
  return streamZip(res, entries, { name: `${path.posix.basename(row.rel)}.zip` });
}

export async function handleShareList(req, res, url, { id }) {
  const row = stmt.getShare.get(id);
  if (!row) return fail(res, 404, '链接无效或已失效');
  if (row.kind !== 'dir') return fail(res, 400, '不是目录分享');
  const { entries } = await listDir(row.rel);
  return json(res, 200, {
    entries: entries.map((e) => ({
      name: e.name, isDir: e.isDir, size: e.size, mtime: e.mtime, kind: e.kind,
    })),
  });
}

export async function handleSystem(req, res) {
  const base = baseUrlOf(req);
  return json(res, 200, {
    device: DEVICE_NAME,
    port: PORT,
    clients: clientCount(),
    disk: diskStats(),
    hosts: usableLanAddresses().map((n) => ({ ...n, url: `http://${n.address}:${PORT}` })),
    self: base,
  });
}
