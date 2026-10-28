import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { STORAGE_ROOT, INTERNAL_DIR } from './config.js';
import { safeRel, sanitizeName, kindOf, uniqueName } from './util.js';

export function absPath(rel) {
  const clean = safeRel(rel);
  const abs = path.join(STORAGE_ROOT, clean);
  const prefix = STORAGE_ROOT + path.sep;
  if (abs !== STORAGE_ROOT && !abs.startsWith(prefix)) {
    throw Object.assign(new Error('路径越界'), { status: 403 });
  }
  return abs;
}

export async function statRel(rel) {
  try {
    return await fsp.lstat(absPath(rel));
  } catch (err) {
    if (err.code === 'ENOENT') throw Object.assign(new Error('文件不存在'), { status: 404 });
    throw err;
  }
}

export async function listDir(rel) {
  const clean = safeRel(rel);
  const entries = await fsp.readdir(absPath(clean), { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    if (entry.name === '.lanshare') continue;
    let info;
    try {
      info = await fsp.lstat(path.join(absPath(clean), entry.name));
    } catch {
      continue;
    }
    const isDir = entry.isDirectory();
    out.push({
      name: entry.name,
      rel: clean ? `${clean}/${entry.name}` : entry.name,
      isDir,
      size: isDir ? 0 : info.size,
      mtime: Math.floor(info.mtimeMs),
      kind: isDir ? 'dir' : kindOf(entry.name),
    });
  }
  out.sort((a, b) => (a.isDir !== b.isDir
    ? (a.isDir ? -1 : 1)
    : a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' })));
  return { rel: clean, entries: out };
}

export function crumbs(rel) {
  const out = [{ name: '全部文件', rel: '' }];
  let acc = '';
  for (const part of rel ? rel.split('/') : []) {
    acc = acc ? `${acc}/${part}` : part;
    out.push({ name: part, rel: acc });
  }
  return out;
}

export function rejectInternal(rel) {
  if (safeRel(rel).split('/').some((part) => part.startsWith('.lanshare'))) {
    throw Object.assign(new Error('路径不可访问'), { status: 403 });
  }
}

export async function freeName(dir, name) {
  const taken = new Set(await fsp.readdir(absPath(dir)).catch(() => []));
  return uniqueName(sanitizeName(name), taken);
}

export function diskStats() {
  try {
    const s = fs.statfsSync(STORAGE_ROOT);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  } catch {
    return { total: 0, free: 0, used: 0 };
  }
}

export async function walk(rel, acc = []) {
  if ((await statRel(rel)).isDirectory()) {
    const { entries } = await listDir(rel);
    for (const entry of entries) await walk(entry.rel, acc);
  } else {
    acc.push(rel);
  }
  return acc;
}

export async function initStorage() {
  await fsp.mkdir(STORAGE_ROOT, { recursive: true });
  await fsp.mkdir(INTERNAL_DIR, { recursive: true });
  await fsp.rm(path.join(INTERNAL_DIR, 'parts'), { recursive: true, force: true });
  await fsp.mkdir(path.join(INTERNAL_DIR, 'parts'), { recursive: true });
}
