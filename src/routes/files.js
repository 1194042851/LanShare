import fsp from 'node:fs/promises';
import path from 'node:path';
import { json, fail, readJson, safeRel, sanitizeName } from '../util.js';
import {
  absPath, listDir, crumbs, statRel, freeName, walk, diskStats,
} from '../storage.js';
import { sendFile } from '../http.js';
import { broadcast } from '../events.js';
import { stmt } from '../db.js';

export async function handleList(req, res, url) {
  const rel = safeRel(url.searchParams.get('dir') || '');
  const { entries } = await listDir(rel);
  return json(res, 200, { rel, crumbs: crumbs(rel), entries });
}

export async function handleFile(req, res, url) {
  const rel = safeRel(url.searchParams.get('path') || '');
  if (!rel) return fail(res, 400, '缺少文件路径');
  const info = await statRel(rel);
  if (info.isDirectory()) return fail(res, 400, '不能以文件方式下载目录');
  return sendFile(req, res, absPath(rel), {
    name: path.posix.basename(rel),
    inline: url.searchParams.get('inline') === '1',
  });
}

/** Inline image for grid tiles; the browser downsamples on decode. */
export async function handleThumb(req, res, url) {
  const rel = safeRel(url.searchParams.get('path') || '');
  if (!rel) return fail(res, 400, '缺少文件路径');
  const info = await statRel(rel);
  if (info.isDirectory()) return fail(res, 400, '不是文件');
  return sendFile(req, res, absPath(rel), {
    name: path.posix.basename(rel),
    inline: true,
    cache: 'public, max-age=86400',
  });
}

export async function handleMkdir(req, res) {
  const body = await readJson(req);
  const dir = safeRel(body.dir || '');
  const name = sanitizeName(body.name);
  const target = dir ? `${dir}/${name}` : name;
  try {
    await fsp.access(absPath(target));
    return fail(res, 409, '同名文件夹已存在');
  } catch {}
  await fsp.mkdir(absPath(target), { recursive: true });
  broadcast('change', { dir });
  return json(res, 201, { rel: target });
}

export async function handleRename(req, res) {
  const body = await readJson(req);
  const from = safeRel(body.path);
  const newName = sanitizeName(body.name);
  const parent = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from);
  const to = parent ? `${parent}/${newName}` : newName;
  if (to === from) return json(res, 200, { rel: to });
  try {
    await fsp.access(absPath(to));
    return fail(res, 409, '同名文件或文件夹已存在');
  } catch {}
  await fsp.rename(absPath(from), absPath(to));
  for (const row of stmt.sharesUnder.all(from, `${from}/%`)) {
    stmt.renameShareRel.run(`${to}${row.rel.slice(from.length)}`, row.id);
  }
  broadcast('change', { dir: parent });
  return json(res, 200, { rel: to });
}

export async function handleDelete(req, res) {
  const body = await readJson(req);
  const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).map(safeRel).filter(Boolean);
  const parents = new Set();
  for (const rel of paths) {
    await fsp.rm(absPath(rel), { recursive: true, force: true });
    stmt.deleteSharesUnder.run(rel, `${rel}/%`);
    const parent = path.posix.dirname(rel);
    parents.add(parent === '.' ? '' : parent);
  }
  for (const dir of parents) broadcast('change', { dir });
  return json(res, 200, { removed: paths.length });
}

export async function handleMove(req, res) {
  const body = await readJson(req);
  const from = safeRel(body.path);
  const toDir = safeRel(body.dir || '');
  if (!from) return fail(res, 400, '缺少源路径');
  if (toDir === from || toDir.startsWith(`${from}/`)) return fail(res, 400, '不能移动到自身内部');
  const name = await freeName(toDir, path.posix.basename(from));
  const target = toDir ? `${toDir}/${name}` : name;
  await fsp.mkdir(absPath(toDir), { recursive: true });
  await fsp.rename(absPath(from), absPath(target));
  const parent = path.posix.dirname(from);
  broadcast('change', { dir: parent === '.' ? '' : parent });
  broadcast('change', { dir: toDir });
  return json(res, 200, { rel: target });
}

export async function handleDisk(req, res) {
  return json(res, 200, diskStats());
}

/** Build a flat file list for a selection (files and folders). */
export async function buildManifest(paths) {
  const files = [];
  let total = 0;
  for (const rel of paths) {
    for (const file of await walk(rel)) {
      files.push({ rel: file });
      total += (await statRel(file)).size;
    }
  }
  return { files, total };
}

export async function handleManifest(req, res) {
  const body = await readJson(req);
  const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).map(safeRel).filter(Boolean);
  if (!paths.length) return fail(res, 400, '没有选中文件');
  return json(res, 200, await buildManifest(paths));
}

/** POST /api/download-zip — stream the selection as one archive. */
export async function handleDownloadZip(req, res) {
  const body = await readJson(req);
  const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).map(safeRel).filter(Boolean);
  if (!paths.length) return fail(res, 400, '没有选中文件');
  const { streamZip } = await import('../zip.js');
  const entries = [];
  for (const rel of paths) {
    for (const file of await walk(rel)) entries.push({ abs: absPath(file), name: file });
  }
  const zipName = paths.length === 1
    ? `${path.posix.basename(paths[0])}.zip`
    : `LanShare-${new Date().toISOString().slice(0, 10)}.zip`;
  return streamZip(res, entries, { name: zipName });
}
