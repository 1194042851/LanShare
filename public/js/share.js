import { $, el, icon, humanSize, fmtDate } from './util.js';
import { api } from './api.js';

const id = location.pathname.split('/').filter(Boolean).pop();
const card = $('#card');
const SVG = (d, size = 30) => icon(d, size, 1.6);

boot();

async function boot() {
  let info;
  try {
    info = await api.shareInfo(id);
  } catch (err) {
    card.replaceChildren(errorBlock(err.status === 404 ? '链接无效或已失效' : '打开失败', err.message));
    return;
  }

  $('#from').textContent = `来自 ${info.device}`;
  document.title = `${info.name} · LanShare`;

  const contentUrl = api.shareContentUrl(id);
  const head = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    el('div', { class: 'share-icon' }, SVG(info.kind === 'dir' ? 'folder' : 'download')),
    el('div', { class: 'share-name' }, info.name),
    el('div', { class: 'share-meta' },
      el('span', {}, info.kind === 'dir' ? '文件夹' : humanSize(info.size)),
      el('span', {}, '·'),
      el('span', {}, fmtDate(info.mtime))));

  card.replaceChildren(head);

  if (info.kind === 'dir') {
    await renderDirectory(info, contentUrl);
  } else {
    const isImage = /\.(png|jpe?g|gif|webp|avif)$/i.test(info.name);
    const actions = el('div', { class: 'share-actions' },
      el('a', { class: 'share-btn share-btn--primary', href: contentUrl, download: info.name },
        SVG('download', 18), '下载文件'));
    if (isImage) {
      actions.append(el('a', {
        class: 'share-btn share-btn--ghost',
        href: api.shareContentUrl(id, { inline: '1' }),
        target: '_blank',
        rel: 'noopener',
      }, SVG('eye', 18), '在线查看'));
    }
    card.append(actions);
  }
}

async function renderDirectory(info, contentUrl) {
  let entries = [];
  try {
    const res = await api.shareList(id);
    entries = res.entries;
  } catch {}

  if (entries.length) {
    const list = el('div', { class: 'entries' });
    for (const entry of entries) {
      const href = entry.isDir
        ? null
        : api.shareContentUrl(id, { path: entry.name });
      list.append(el(entry.isDir ? 'div' : 'a', {
        class: 'entries__row',
        ...(entry.isDir ? {} : { href, download: entry.name }),
      },
        SVG(entry.isDir ? 'folder' : 'file', 17),
        el('span', { class: 'entries__name' }, entry.name),
        el('span', { class: 'entries__size' }, entry.isDir ? '' : humanSize(entry.size))));
    }
    card.append(list);
  }

  card.append(el('div', { class: 'share-actions' },
    el('a', { class: 'share-btn share-btn--primary', href: contentUrl, download: `${info.name}.zip` },
      SVG('download', 18),
      entries.length ? `打包下载全部 (${entries.length})` : '下载文件夹')));
}

function errorBlock(title, text) {
  return el('div', { class: 'share-error' },
    el('div', { class: 'share-icon', style: { color: 'var(--danger)' } }, SVG('alert')),
    el('div', { class: 'share-error__title' }, title),
    el('div', { class: 'share-error__text' }, text || '请联系分享人确认链接是否仍然有效。'));
}
