import path from 'node:path';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import { PARTIAL_DIR, PORT, DEVICE_NAME, usableLanAddresses, primaryLanAddress } from '../config.js';
import { stmt } from '../db.js';
import { absPath, statRel, listDir, diskStats, walk, freeName, rejectInternal } from '../storage.js';
import { json, fail, readJson, safeRel, randomId, sanitizeName } from '../util.js';
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
    name: row.title || path.posix.basename(row.rel),
    allowUpload: Boolean(row.allow_upload),
    createdAt: row.created_at,
    url: `${base}/s/${row.id}`,
  };
}

/* ------------------------------------------------------------- one-off shares */

export async function handleCreateShare(req, res) {
  const body = await readJson(req);
  const rel = safeRel(body.path);
  if (!rel) return fail(res, 400, '不能分享根目录');
  const info = await statRel(rel);
  const id = randomId(7);
  stmt.insertShare.run(id, rel, info.isDirectory() ? 'dir' : 'file', Date.now(), null, 0);
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
  const visible = rows.filter((row) => row.kind !== 'space');
  return json(res, 200, { shares: visible.map((row) => sharePayload(row, base)) });
}

export async function handleDeleteShare(req, res, url, { id }) {
  stmt.deleteShare.run(id);
  broadcast('shares');
  return json(res, 200, { ok: true });
}

/* ------------------------------------------------------------- shared spaces */

export async function handleCreateSpace(req, res) {
  const body = await readJson(req);
  const title = sanitizeName(body.name || '共享空间');
  const parent = safeRel(body.parent || '');
  rejectInternal(parent);

  const folder = await freeName(parent, title);
  const rel = parent ? `${parent}/${folder}` : folder;
  await fsp.mkdir(absPath(rel), { recursive: true });

  const id = randomId(7);
  stmt.insertShare.run(id, rel, 'space', Date.now(), title, 1);
  broadcast('shares');
  broadcast('change', { dir: parent });
  return json(res, 201, sharePayload(stmt.getShare.get(id), baseUrlOf(req)));
}

export async function handleListSpaces(req, res) {
  const base = baseUrlOf(req);
  const rows = [];
  for (const row of stmt.sharesByKind.all('space')) {
    try {
      await statRel(row.rel);
      rows.push(row);
    } catch {}
  }
  return json(res, 200, { spaces: rows.map((row) => sharePayload(row, base)) });
}

export async function handleUpdateSpace(req, res, url, { id }) {
  const row = stmt.getShare.get(id);
  if (!row || row.kind !== 'space') return fail(res, 404, '共享空间不存在');
  const body = await readJson(req);
  if (body.allowUpload !== undefined) {
    stmt.setSpaceUpload.run(body.allowUpload ? 1 : 0, id);
  }
  if (body.title) {
    stmt.setSpaceTitle.run(String(body.title).slice(0, 120), id);
  }
  broadcast('shares');
  return json(res, 200, sharePayload(stmt.getShare.get(id), baseUrlOf(req)));
}

export async function handleDeleteSpace(req, res, url, { id }) {
  const row = stmt.getShare.get(id);
  if (!row) return fail(res, 404, '共享空间不存在');
  // Only the link is revoked — the folder and its files stay on disk.
  stmt.deleteShare.run(id);
  broadcast('shares');
  return json(res, 200, { ok: true });
}

/* ------------------------------------------------------------- public access */

function spaceRow(id) {
  const row = stmt.getShare.get(id);
  if (!row) throw Object.assign(new Error('链接无效或已失效'), { status: 404 });
  return row;
}

/** Resolve a path inside a space; rejects anything that escapes it. */
function spacePath(row, sub) {
  const clean = safeRel(sub || '');
  const full = clean ? `${row.rel}/${clean}` : row.rel;
  const root = absPath(row.rel);
  const target = absPath(full);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw Object.assign(new Error('路径越界'), { status: 403 });
  }
  return { rel: full, abs: target, sub: clean };
}

export async function handleShareInfo(req, res, url, { id }) {
  const row = spaceRow(id);
  let info;
  try {
    info = await statRel(row.rel);
  } catch {
    return fail(res, 404, '分享的文件已被删除');
  }
  return json(res, 200, {
    id: row.id,
    kind: row.kind,
    name: row.title || path.posix.basename(row.rel),
    size: row.kind === 'file' ? info.size : null,
    mtime: Math.floor(info.mtimeMs),
    allowUpload: Boolean(row.allow_upload),
    device: DEVICE_NAME,
  });
}

export async function handleShareList(req, res, url, { id }) {
  const row = spaceRow(id);
  if (row.kind === 'file') return fail(res, 400, '不是目录分享');
  const { rel, sub } = spacePath(row, url.searchParams.get('path') || '');
  const info = await statRel(rel);
  if (!info.isDirectory()) return fail(res, 400, '不是目录');

  const { entries } = await listDir(rel);
  const base = sub ? `${sub}/` : '';
  return json(res, 200, {
    path: sub,
    parent: sub.includes('/') ? sub.slice(0, sub.lastIndexOf('/')) : '',
    allowUpload: Boolean(row.allow_upload),
    entries: entries.map((e) => ({
      name: e.name,
      path: `${base}${e.name}`,
      isDir: e.isDir,
      size: e.size,
      mtime: e.mtime,
      kind: e.kind,
    })),
  });
}

export async function handleShareContent(req, res, url, { id }) {
  const row = spaceRow(id);
  if (row.kind === 'file') {
    return sendFile(req, res, absPath(row.rel), {
      name: path.posix.basename(row.rel),
      inline: url.searchParams.get('inline') === '1',
    });
  }

  const { rel, abs, sub } = spacePath(row, url.searchParams.get('path') || '');
  const info = await statRel(rel);

  if (info.isDirectory()) {
    const entries = [];
    for (const file of await walk(rel)) {
      const inner = file.slice(rel.length + 1);
      entries.push({ abs: absPath(file), name: inner });
    }
    const zipName = sub ? `${path.posix.basename(sub)}.zip` : `${path.posix.basename(row.rel)}.zip`;
    return streamZip(res, entries, { name: zipName });
  }

  return sendFile(req, res, abs, {
    name: path.posix.basename(rel),
    inline: url.searchParams.get('inline') === '1',
  });
}

/**
 * PUT /api/s/:id/upload?path=<dir>&name=<file>
 * Raw body streaming (no multipart), so phones can push large videos without
 * buffering them in memory on either side.
 */
export async function handleShareUpload(req, res, url, { id }) {
  const row = spaceRow(id);
  if (row.kind !== 'space' || !row.allow_upload) {
    return fail(res, 403, '这个共享空间不允许上传');
  }

  const sub = safeRel(url.searchParams.get('path') || '');
  const { rel: dirRel } = spacePath(row, sub);
  const info = await statRel(dirRel);
  if (!info.isDirectory()) return fail(res, 400, '目标不是目录');

  const name = sanitizeName(url.searchParams.get('name') || '');
  const finalName = await freeName(dirRel, name);
  const targetRel = `${dirRel}/${finalName}`;
  const targetAbs = absPath(targetRel);
  const tempAbs = path.join(PARTIAL_DIR, `${id}-${randomId(6)}`);

  const out = await fsp.open(tempAbs, 'w');
  let written = 0;
  try {
    for await (const chunk of req) {
      await out.write(chunk);
      written += chunk.length;
    }
    await out.close();
    await fsp.rename(tempAbs, targetAbs);
  } catch (err) {
    await out.close().catch(() => {});
    await fsp.rm(tempAbs, { force: true }).catch(() => {});
    throw Object.assign(new Error(`上传失败：${err.message}`), { status: 500 });
  }

  broadcast('change', { dir: dirRel });
  return json(res, 201, { name: finalName, path: `${sub ? `${sub}/` : ''}${finalName}`, size: written });
}

/* -------------------------------------------------------------------- system */

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
