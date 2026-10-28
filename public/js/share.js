import { $, el, icon, humanSize, fmtDate } from './util.js';
import { api } from './api.js';

const id = location.pathname.split('/').filter(Boolean).pop();
const card = $('#card');
const SVG = (name, size = 30) => icon(name, size, 1.6);

const state = {
  info: null,
  path: '',
  entries: [],
  allowUpload: false,
  uploading: false,
};

boot();

async function boot() {
  try {
    state.info = await api.shareInfo(id);
  } catch (err) {
    card.replaceChildren(errorBlock(
      err.status === 404 ? '链接无效或已失效' : '打开失败',
      err.message,
    ));
    return;
  }

  const info = state.info;
  $('#from').textContent = `来自 ${info.device}`;
  document.title = `${info.name} · LanShare`;

  if (info.kind === 'space') {
    state.allowUpload = Boolean(info.allowUpload);
    await loadDir('');
    return;
  }

  if (info.kind === 'dir') {
    await loadDir('');
    return;
  }

  renderSingle(info);
}

/* ------------------------------------------------------------ single file */

function renderSingle(info) {
  const contentUrl = api.shareContentUrl(id);
  const head = el('div', { class: 'share-head-block' },
    el('div', { class: 'share-icon' }, SVG('download')),
    el('div', { class: 'share-name' }, info.name),
    el('div', { class: 'share-meta' },
      el('span', {}, humanSize(info.size)),
      el('span', {}, '·'),
      el('span', {}, fmtDate(info.mtime))));

  card.replaceChildren(head);

  const actions = el('div', { class: 'share-actions' },
    el('a', { class: 'share-btn share-btn--primary', href: contentUrl, download: info.name },
      SVG('download', 18), '下载文件'));

  if (/\.(png|jpe?g|gif|webp|avif)$/i.test(info.name)) {
    actions.append(el('a', {
      class: 'share-btn share-btn--ghost',
      href: api.shareContentUrl(id, { inline: '1' }),
      target: '_blank',
      rel: 'noopener',
    }, SVG('eye', 18), '在线查看'));
  }

  card.append(actions);
}

/* --------------------------------------------------------------- directory */

async function loadDir(sub) {
  card.classList.add('is-loading');
  try {
    const data = await api.shareList(id, sub);
    state.path = data.path || '';
    state.entries = data.entries || [];
    state.allowUpload = Boolean(data.allowUpload);
  } catch (err) {
    card.replaceChildren(errorBlock('读取目录失败', err.message));
    card.classList.remove('is-loading');
    return;
  }
  card.classList.remove('is-loading');
  renderDir();
}

function renderDir() {
  const info = state.info;
  const atRoot = !state.path;
  const parts = state.path ? state.path.split('/') : [];

  const head = el('div', { class: 'space-head' },
    el('div', { class: 'space-title-row' },
      el('div', { class: 'share-icon share-icon--sm' }, SVG('folder', 24)),
      el('div', { class: 'space-title' },
        el('div', { class: 'share-name share-name--left' }, info.name),
        el('div', { class: 'share-meta share-meta--left' },
          el('span', {}, atRoot ? `${state.entries.length} 项` : `${state.entries.length} 项`),
          state.allowUpload ? el('span', { class: 'tag tag--sig' }, '可上传') : null))));

  const crumbs = el('nav', { class: 'space-crumbs', 'aria-label': '目录' },
    el('button', { class: 'crumb', onclick: () => loadDir('') }, info.name),
    ...parts.flatMap((part, i) => {
      const target = parts.slice(0, i + 1).join('/');
      return [
        el('span', { class: 'crumb-sep' }, '/'),
        el('button', { class: 'crumb', onclick: () => loadDir(target) }, part),
      ];
    }));

  card.replaceChildren(head, crumbs);

  if (state.path) {
    card.append(el('button', { class: 'back-link', onclick: () => loadDir(parentOf(state.path)) },
      SVG('chevronLeft', 15), '返回上级'));
  }

  if (!state.entries.length) {
    card.append(el('div', { class: 'space-empty' },
      el('div', { class: 'space-empty__title' }, state.allowUpload ? '这里还是空的' : '这个目录是空的'),
      el('div', { class: 'space-empty__text' },
        state.allowUpload ? '点下面的「上传文件」，或从电脑上直接拖进这个文件夹。' : '分享者还没有放入文件。')));
  } else {
    const list = el('div', { class: 'entries' });
    for (const entry of sorted(state.entries)) list.append(entryRow(entry));
    card.append(list);
  }

  const actions = el('div', { class: 'share-actions' });
  if (state.allowUpload) {
    actions.append(uploadButton());
  }
  if (state.entries.length) {
    actions.append(el('a', {
      class: 'share-btn share-btn--ghost',
      href: api.shareContentUrl(id, state.path ? { path: state.path } : {}),
      download: `${atRoot ? info.name : parts[parts.length - 1]}.zip`,
    }, SVG('download', 18), atRoot ? '打包下载全部' : '打包下载此目录'));
  }
  card.append(actions);

  const input = $('#spaceFileInput');
  if (input) input.onchange = handleFiles;
}

function parentOf(p) {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
}

function sorted(entries) {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

function entryRow(entry) {
  if (entry.isDir) {
    return el('button', { class: 'entries__row entries__row--dir', onclick: () => loadDir(entry.path) },
      SVG('folder', 18),
      el('span', { class: 'entries__name' }, entry.name),
      SVG('chevronRight', 15),
      el('span', { class: 'entries__size' }, ''));
  }
  return el('a', {
    class: 'entries__row',
    href: api.shareContentUrl(id, { path: entry.path }),
    download: entry.name,
  },
    SVG(iconName(entry.kind), 18),
    el('span', { class: 'entries__name' }, entry.name),
    el('span', { class: 'entries__size' }, humanSize(entry.size)));
}

function iconName(kind) {
  return ['image', 'video', 'audio', 'archive', 'pdf', 'doc', 'text'].includes(kind)
    ? kind === 'archive' ? 'archive' : kind === 'doc' ? 'doc' : kind
    : 'file';
}

/* ---------------------------------------------------------------- uploads */

function uploadButton() {
  const wrap = el('div', { class: 'upload-wrap' },
    el('button', {
      class: 'share-btn share-btn--primary',
      onclick: () => $('#spaceFileInput').click(),
      disabled: state.uploading ? '' : null,
    }, SVG('upload', 18), state.uploading ? '上传中…' : '上传文件'),
    el('input', {
      type: 'file',
      id: 'spaceFileInput',
      multiple: '',
      hidden: '',
      onchange: handleFiles,
    }));
  return wrap;
}

async function handleFiles(e) {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;

  state.uploading = true;
  renderDir();

  const bar = el('div', { class: 'upload-status' });
  card.append(bar);

  let done = 0;
  let failed = 0;

  for (const file of files) {
    bar.replaceChildren(
      el('div', { class: 'upload-status__row' },
        el('span', { class: 'upload-status__name' }, `正在上传 ${file.name}`),
        el('span', { class: 'upload-status__pct' }, `${done + failed}/${files.length}`)),
      el('div', { class: 'upload-status__bar' },
        el('div', { class: 'upload-status__fill', style: { width: '0%' } })));
    const fill = bar.querySelector('.upload-status__fill');

    try {
      await api.uploadToShare(id, {
        path: state.path,
        name: file.name,
        file,
        onProgress: (loaded, total) => {
          fill.style.width = `${total ? Math.round((loaded / total) * 100) : 0}%`;
        },
      });
      done++;
    } catch (err) {
      failed++;
      if (failed === 1) bar.append(el('div', { class: 'upload-status__error' }, err.message));
    }
  }

  state.uploading = false;
  await loadDir(state.path);
  bar.replaceChildren(el('div', {
    class: 'upload-status__done',
  }, failed ? `完成 ${done} 个，失败 ${failed} 个` : `已上传 ${done} 个文件`));
  card.append(bar);
  setTimeout(() => bar.remove(), 2600);
}

/* ------------------------------------------------------------------ errors */

function errorBlock(title, text) {
  return el('div', { class: 'share-error' },
    el('div', { class: 'share-icon', style: { color: 'var(--danger)' } }, SVG('alert')),
    el('div', { class: 'share-error__title' }, title),
    el('div', { class: 'share-error__text' }, text || '请联系分享人确认链接是否仍然有效。'));
}
