import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PARTIAL_DIR, MAX_UPLOAD_BYTES } from '../config.js';
import { rejectInternal, absPath, freeName } from '../storage.js';
import {
  safeRel, sanitizeName, readJson, json, fail, humanSize,
} from '../util.js';
import { broadcast } from '../events.js';

// In-memory sessions: a server restart just means "start the upload again",
// which is the right trade for a single-user tool.
const sessions = new Map();

function chunkLength(session, index) {
  const start = index * session.chunkSize;
  return Math.min(start + session.chunkSize, session.size) - start;
}

/** POST /api/upload/init */
export async function handleInit(req, res) {
  const body = await readJson(req);
  const size = Number(body.size);
  const dir = safeRel(body.dir || '');
  const name = sanitizeName(body.name);
  const chunkSize = Math.max(256 * 1024, Math.min(Number(body.chunkSize) || 4 * 1024 * 1024, 32 * 1024 * 1024));

  if (!Number.isFinite(size) || size < 0) return fail(res, 400, '文件大小无效');
  if (size > MAX_UPLOAD_BYTES) return fail(res, 413, `文件超过上限 ${humanSize(MAX_UPLOAD_BYTES)}`);
  rejectInternal(dir);
  await fsp.mkdir(absPath(dir), { recursive: true });

  const id = crypto.randomUUID().replace(/-/g, '');
  const session = {
    id, dir, name, size, chunkSize,
    parts: new Set(),
    mtime: body.mtime ? Number(body.mtime) : null,
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  await fsp.mkdir(path.join(PARTIAL_DIR, id), { recursive: true });

  return json(res, 201, {
    uploadId: id, chunkSize, size,
    totalChunks: Math.max(1, Math.ceil(size / chunkSize)),
  });
}

/** PUT /api/upload/:id/chunk?index=N */
export async function handleChunk(req, res, url, { id }) {
  const session = sessions.get(id);
  if (!session) return fail(res, 404, '上传会话不存在或已过期');
  const index = Number(url.searchParams.get('index'));
  const total = Math.max(1, Math.ceil(session.size / session.chunkSize));
  if (!Number.isInteger(index) || index < 0 || index >= total) return fail(res, 400, '分片序号无效');

  const file = path.join(PARTIAL_DIR, id, String(index));
  const handle = await fsp.open(file, 'w');
  try {
    for await (const chunk of req) await handle.write(chunk);
  } finally {
    await handle.close();
  }
  session.parts.add(index);
  return json(res, 200, { index, received: [...session.parts].length, total });
}

/** POST /api/upload/:id/complete */
export async function handleComplete(req, res, url, { id }) {
  const session = sessions.get(id);
  if (!session) return fail(res, 404, '上传会话不存在或已过期');
  const total = Math.max(1, Math.ceil(session.size / session.chunkSize));

  for (let i = 0; i < total; i++) {
    if (!session.parts.has(i)) return fail(res, 409, `缺少分片 ${i + 1}/${total}`);
  }
  await fsp.mkdir(absPath(session.dir), { recursive: true });

  const finalName = await freeName(session.dir, session.name);
  const targetAbs = absPath(session.dir ? `${session.dir}/${finalName}` : finalName);
  const tempAbs = path.join(PARTIAL_DIR, id, '.assembled');

  const out = await fsp.open(tempAbs, 'w');
  try {
    for (let i = 0; i < total; i++) {
      const stream = fs.createReadStream(path.join(PARTIAL_DIR, id, String(i)));
      for await (const chunk of stream) await out.write(chunk);
    }
    await out.close();
  } catch (err) {
    await out.close().catch(() => {});
    throw Object.assign(new Error(`合并失败：${err.message}`), { status: 500 });
  }
  await fsp.rename(tempAbs, targetAbs);

  if (session.mtime) {
    const mtime = new Date(session.mtime);
    await fsp.utimes(targetAbs, mtime, mtime).catch(() => {});
  }

  sessions.delete(id);
  await fsp.rm(path.join(PARTIAL_DIR, id), { recursive: true, force: true });

  const rel = session.dir ? `${session.dir}/${finalName}` : finalName;
  broadcast('change', { dir: session.dir });
  return json(res, 201, { rel, name: finalName, size: session.size });
}

/** DELETE /api/upload/:id */
export async function handleCancel(req, res, url, { id }) {
  sessions.delete(id);
  await fsp.rm(path.join(PARTIAL_DIR, id), { recursive: true, force: true });
  return json(res, 200, { ok: true });
}
