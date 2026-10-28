import { $, $$, el, icon, humanSize, humanTime, relTime, debounce, copyText, fmtDate } from './util.js';
import { api, downloadUrl, previewUrl, thumbUrl, triggerDownload } from './api.js';
import { enqueue, onTransfer, cancelJob, clearFinished, activeCount } from './upload.js';

const state = {
  route: 'files',
  dir: '',
  crumbs: [],
  entries: [],
  selection: new Set(),
  view: localStorage.getItem('ls:view') || 'list',
  query: '',
  shares: [],
  loading: false,
  system: null,
};

const view = $('#view');
const toast = makeToaster();

/* ------------------------------------------------------------------ boot */

initTheme();
bindChrome();
loadSystem();
routeFromHash();
addEventListener('hashchange', routeFromHash);

async function loadSystem() {
  try {
    state.system = await api.system();
    $('#deviceName').textContent = state.system.device;
    $('#clientCount').textContent = `${state.system.clients || 1} 台设备在线`;
  } catch {}
  setTimeout(loadSystem, 15000);
}

/* --------------------------------------------------------------- routing */

function routeFromHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, ...rest] = hash.split('/');
  if (route === 's' && rest[0]) return; // public share page handles itself
  state.route = ['files', 'shares'].includes(route) ? route : 'files';
  if (state.route === 'files') {
    state.dir = decodeURIComponent(rest.join('/'));
  }
  syncNav();
  render();
}

function syncNav() {
  for (const btn of $$('[data-route]')) {
    if (btn.dataset.route === state.route) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function go(route, dir = '') {
  const next = route === 'shares' ? '#/shares' : `#/files${dir ? `/${encodeURI(dir)}` : ''}`;
  if (location.hash === next) render();
  else location.hash = next;
}

/* ------------------------------------------------------------------- render */

async function render() {
  if (state.route === 'shares') return renderShares();
  return renderFiles();
}

async function renderFiles() {
  state.selection.clear();
  updateBulkbar();
  view.replaceChildren(skeleton());
  try {
    const data = await api.list(state.dir);
    state.crumbs = data.crumbs;
    state.entries = data.entries;
  } catch (err) {
    // A stale directory (deleted elsewhere) falls back to the root.
    if (err.status === 404 && state.dir) {
      toast('该目录已不存在', 'error');
      return go('files', '');
    }
    view.replaceChildren(errorState(err.message));
    return;
  }
  paintFiles();
}

function skeleton() {
  return el('div', { class: 'section' },
    el('div', { class: 'dropzone', style: { opacity: '0.55' } },
      el('div', { class: 'dropzone__icon' }, icon('upload', 22)),
      el('div', { class: 'dropzone__text' },
        el('div', { class: 'dropzone__title' }, '正在读取目录…'),
        el('div', { class: 'dropzone__hint' }, ' '))));
}

function paintFiles() {
  renderCrumbs();
  const needle = state.query.trim().toLowerCase();
  const visible = needle
    ? state.entries.filter((e) => e.name.toLowerCase().includes(needle))
    : state.entries;

  const frag = document.createDocumentFragment();
  frag.append(dropzone());

  if (!state.entries.length) {
    frag.append(emptyState());
  } else if (!visible.length) {
    frag.append(el('div', { class: 'section' },
      el('div', { class: 'empty' },
        el('div', { class: 'empty__title' }, `没找到“${state.query}”`),
        el('div', { class: 'empty__text' }, '试试别的关键词，或清除搜索查看全部。'),
        el('div', { class: 'empty__actions' },
          el('button', { class: 'btn btn--ghost', onclick: () => { state.query = ''; $('#search').value = ''; paintFiles(); } }, '清除搜索')))));
  } else {
    const folders = visible.filter((e) => e.isDir).length;
    const files = visible.length - folders;
    const totalSize = visible.reduce((s, e) => s + (e.isDir ? 0 : e.size), 0);
    frag.append(el('div', { class: 'section' },
      el('div', { class: 'section__head' },
        el('div', { class: 'section__title' }, '当前目录'),
        el('div', { class: 'section__meta' },
          `${folders} 个文件夹 · ${files} 个文件 · ${humanSize(totalSize)}`)),
      state.view === 'grid' ? gridView(visible) : listView(visible)));
  }

  view.replaceChildren(frag);
  updateBulkbar();
}

function renderCrumbs() {
  const nav = $('#crumbs');
  const parts = [];
  state.crumbs.forEach((crumb, i) => {
    if (i) parts.push(el('span', { class: 'crumbs__sep', 'aria-hidden': 'true' }, '/'));
    parts.push(el('button', {
      class: 'crumbs__link',
      onclick: () => go('files', crumb.rel),
      title: crumb.name,
    }, crumb.name));
  });
  nav.replaceChildren(...parts);
  document.title = state.dir
    ? `${state.dir.split('/').pop()} · LanShare`
    : 'LanShare · 局域网共享';
}

function dropzone() {
  const zone = el('div', { class: 'dropzone' },
    el('div', { class: 'dropzone__icon' }, icon('upload', 22)),
    el('div', { class: 'dropzone__text' },
      el('div', { class: 'dropzone__title' }, '拖入文件即可上传'),
      el('div', { class: 'dropzone__hint' },
        '支持多选与文件夹 · 大文件自动分片 · 可随时暂停')),
    el('div', { style: { display: 'flex', gap: '8px', flex: 'none' } },
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onclick: (e) => { e.stopPropagation(); $('#folderInput').click(); },
        title: '上传整个文件夹',
      }, '文件夹'),
      el('button', {
        class: 'btn btn--primary btn--sm',
        onclick: (e) => { e.stopPropagation(); $('#fileInput').click(); },
      }, '选择文件')));
  zone.addEventListener('click', () => $('#fileInput').click());
  return zone;
}

function listView(entries) {
  const rows = el('div', { class: 'rows' });
  for (const entry of entries) rows.append(fileRow(entry));
  return rows;
}

function fileRow(entry) {
  const row = el('div', {
    class: 'row',
    dataset: { rel: entry.rel },
    draggable: 'true',
  });

  const check = el('div', { class: 'row__check' },
    el('input', {
      type: 'checkbox',
      'aria-label': `选择 ${entry.name}`,
      onchange: (e) => toggleSelect(entry.rel, e.target.checked),
    }));

  const iconBox = el('div', { class: 'row__icon', dataset: { kind: entry.kind } });
  if (entry.kind === 'image') {
    const img = el('img', { src: thumbUrl(entry.rel, 96), alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => { img.replaceWith(icon(iconFor(entry), 19)); });
    iconBox.append(img);
  } else {
    iconBox.append(icon(iconFor(entry), 19));
  }

  const name = el('div', { class: 'row__name' },
    el('div', { class: 'row__title', title: entry.name }, entry.name),
    el('div', { class: 'row__sub' }, entry.isDir ? '文件夹' : `${entry.kind.toUpperCase()} · ${humanSize(entry.size)}`));

  const size = el('div', { class: 'row__cell row__cell--size' }, entry.isDir ? '—' : humanSize(entry.size));
  const date = el('div', { class: 'row__cell row__cell--date', title: fmtDate(entry.mtime) }, relTime(entry.mtime));

  const actions = el('div', { class: 'row__share' },
    el('button', {
      class: 'btn btn--quiet',
      title: '更多',
      'aria-label': `${entry.name} 的操作`,
      onclick: (e) => { e.stopPropagation(); openActions(entry, e.currentTarget); },
    }, icon('more', 16)));

  row.append(check, iconBox, name, size, date, actions);
  wireRow(row, entry);
  return row;
}

function gridView(entries) {
  const grid = el('div', { class: 'tiles' });
  for (const entry of entries) {
    const tile = el('button', { class: 'tile', dataset: { rel: entry.rel } });
    const thumb = el('div', { class: 'tile__thumb', dataset: { kind: entry.kind } });
    if (entry.kind === 'image') {
      const img = el('img', { src: thumbUrl(entry.rel, 480), alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => { img.replaceWith(icon(iconFor(entry), 30)); });
      thumb.append(img);
    } else {
      thumb.append(icon(iconFor(entry), 30));
    }
    tile.append(
      el('label', { class: 'tile__check', onclick: (e) => e.stopPropagation() },
        el('input', {
          type: 'checkbox',
          'aria-label': `选择 ${entry.name}`,
          onchange: (e) => toggleSelect(entry.rel, e.target.checked),
        })),
      thumb,
      el('div', { class: 'tile__name', title: entry.name }, entry.name),
      el('div', { class: 'tile__meta' },
        el('span', {}, entry.isDir ? '文件夹' : humanSize(entry.size)),
        el('span', {}, relTime(entry.mtime))));
    wireRow(tile, entry);
    grid.append(tile);
  }
  return grid;
}

function wireRow(node, entry) {
  node.addEventListener('click', (e) => {
    if (e.target.closest('input,button,label')) return;
    if (entry.isDir) go('files', entry.rel);
    else if (state.view === 'grid') openActions(entry, node);
    else preview(entry);
  });
  node.addEventListener('dblclick', () => {
    if (!entry.isDir) preview(entry);
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openActions(entry, node, { x: e.clientX, y: e.clientY });
  });
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-lanshare', entry.rel);
    e.dataTransfer.effectAllowed = 'move';
    node.style.opacity = '0.5';
  });
  node.addEventListener('dragend', () => { node.style.opacity = ''; });
  if (entry.isDir) {
    node.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-lanshare')) return;
      e.preventDefault();
      node.classList.add('is-drop');
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-drop'));
    node.addEventListener('drop', async (e) => {
      const from = e.dataTransfer.getData('application/x-lanshare');
      node.classList.remove('is-drop');
      if (!from) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        await api.move(from, entry.rel);
        toast(`已移动到「${entry.name}」`);
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

function iconFor(entry) {
  if (entry.isDir) return 'folder';
  return ['image', 'video', 'audio', 'archive', 'pdf', 'doc', 'text'].includes(entry.kind)
    ? entry.kind
    : 'file';
}

function emptyState() {
  return el('div', { class: 'section' },
    el('div', { class: 'empty' },
      el('div', { class: 'empty__mark' }, icon('inbox', 52, 1.4)),
      el('div', { class: 'empty__title' }, '这里还没有文件'),
      el('div', { class: 'empty__text' }, '把文件拖进上面的区域，或在手机上点「上传」选择照片和文档。'),
      el('div', { class: 'empty__actions' },
        el('button', { class: 'btn btn--primary', onclick: () => $('#fileInput').click() },
          icon('upload', 16), '上传文件'),
        el('button', { class: 'btn btn--ghost', onclick: () => newFolder() }, icon('folderPlus', 16), '新建文件夹'))));
}

function errorState(message) {
  return el('div', { class: 'section' },
    el('div', { class: 'empty' },
      el('div', { class: 'empty__mark' }, icon('alert', 52, 1.4)),
      el('div', { class: 'empty__title' }, '加载失败'),
      el('div', { class: 'empty__text' }, message),
      el('div', { class: 'empty__actions' },
        el('button', { class: 'btn btn--ghost', onclick: () => render() }, '重试'))));
}

/* ------------------------------------------------------------------ shares */

async function renderShares() {
  view.replaceChildren(el('div', { class: 'section' },
    el('div', { class: 'section__head' }, el('div', { class: 'section__title' }, '分享链接'))));
  try {
    const { shares } = await api.shares();
    state.shares = shares;
  } catch (err) {
    view.replaceChildren(errorState(err.message));
    return;
  }
  renderCrumbsEmpty('分享链接');
  const frag = document.createDocumentFragment();
  frag.append(el('div', { class: 'section' },
    el('div', { class: 'section__head' },
      el('div', { class: 'section__title' }, '已创建的链接'),
      el('div', { class: 'section__meta' }, `${state.shares.length} 个`))));

  if (!state.shares.length) {
    frag.append(el('div', { class: 'section' },
      el('div', { class: 'empty' },
        el('div', { class: 'empty__mark' }, icon('share', 52, 1.4)),
        el('div', { class: 'empty__title' }, '还没有分享链接'),
        el('div', { class: 'empty__text' }, '在文件列表里选择文件或文件夹，点「分享」就会生成一个局域网内可访问的链接。'),
        el('div', { class: 'empty__actions' },
          el('button', { class: 'btn btn--primary', onclick: () => go('files') }, '去选文件')))));
  } else {
    const list = el('div', { class: 'share-list', style: { padding: '0 2px' } });
    for (const share of state.shares) list.append(shareCard(share));
    frag.append(el('div', { class: 'section' }, list));
  }
  view.replaceChildren(frag);
}

function renderCrumbsEmpty(title) {
  $('#crumbs').replaceChildren(el('span', { class: 'crumbs__link' }, title));
  document.title = `${title} · LanShare`;
}

function shareCard(share) {
  return el('div', { class: 'share-card' },
    el('div', { class: 'row__icon', dataset: { kind: share.kind === 'dir' ? 'dir' : 'file' } },
      icon(share.kind === 'dir' ? 'folder' : 'file', 19)),
    el('div', { class: 'share-card__body' },
      el('div', { class: 'share-card__name' }, share.name),
      el('div', { class: 'share-card__link' }, share.url),
      el('div', { class: 'share-card__tags' },
        el('span', { class: 'tag' }, share.kind === 'dir' ? '文件夹' : '文件'),
        el('span', { class: 'tag' }, relTime(share.createdAt)))),
    el('div', { style: { display: 'flex', gap: '4px' } },
      el('button', {
        class: 'btn btn--quiet btn--icon btn--sm',
        title: '复制链接',
        onclick: async () => {
          await copyText(share.url);
          toast('链接已复制');
        },
      }, icon('link', 16)),
      el('button', {
        class: 'btn btn--quiet btn--icon btn--sm',
        title: '二维码',
        onclick: () => showQr(share),
      }, icon('qr', 16)),
      el('button', {
        class: 'btn btn--quiet btn--icon btn--sm',
        title: '取消分享',
        style: { color: 'var(--danger)' },
        onclick: async () => {
          await api.deleteShare(share.id);
          toast('已取消分享');
          renderShares();
        },
      }, icon('trash', 16))));
}

/* -------------------------------------------------------------- selection */

function toggleSelect(rel, on) {
  if (on) state.selection.add(rel);
  else state.selection.delete(rel);
  const node = view.querySelector(`[data-rel="${CSS.escape(rel)}"]`);
  node?.classList.toggle('is-selected', on);
  const box = node?.querySelector('input[type=checkbox]');
  if (box && box.checked !== on) box.checked = on;
  updateBulkbar();
}

function updateBulkbar() {
  const bar = $('#bulkbar');
  const count = state.selection.size;
  bar.classList.toggle('is-open', count > 0);
  $('#selCount').textContent = count;
}

function clearSelection() {
  state.selection.clear();
  for (const box of $$('.row input[type=checkbox], .tile input[type=checkbox]')) box.checked = false;
  for (const node of $$('.is-selected')) node.classList.remove('is-selected');
  updateBulkbar();
}

/* ---------------------------------------------------------------- actions */

function openActions(entry, anchor, point) {
  const menu = el('div', { class: 'menu' });
  const item = (label, iconName, fn, danger = false) => {
    const btn = el('button', { class: 'menu__item' + (danger ? ' menu__item--danger' : '') },
      icon(iconName, 16), el('span', {}, label));
    btn.onclick = () => { close(); fn(); };
    return btn;
  };
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };

  const actions = entry.isDir
    ? [['打开', 'folder', () => go('files', entry.rel)]]
    : [['预览', 'eye', () => preview(entry)], ['下载', 'download', () => triggerDownload(downloadUrl(entry.rel), entry.name)]];

  for (const [label, ico, fn] of actions) menu.append(item(label, ico, fn));
  menu.append(item('分享', 'share', () => createShare([entry.rel])));
  menu.append(item(entry.isDir ? '下载为 ZIP' : '复制', 'copy', () => {
    if (entry.isDir) return zipDownload([entry.rel]);
    navigator.clipboard?.writeText(entry.name);
    toast('文件名已复制');
  }));
  menu.append(item('重命名', 'edit', () => renameEntry(entry)));
  menu.append(item('删除', 'trash', () => removeEntries([entry.rel], entry.name), true));

  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const x = point?.x ?? rect.right - 8;
  const y = point?.y ?? rect.bottom + 6;
  menu.style.left = `${Math.min(x, innerWidth - 200)}px`;
  menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 12)}px`;
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > innerWidth - 8) menu.style.left = `${innerWidth - r.width - 8}px`;
    if (r.bottom > innerHeight - 8) menu.style.top = `${innerHeight - r.height - 8}px`;
  });
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}

function newFolder() {
  modal({
    title: '新建文件夹',
    body: (body) => {
      const input = el('input', { class: 'input', placeholder: '文件夹名称', value: '' });
      body.append(el('div', { class: 'field' },
        el('label', { class: 'field__label' }, '名称'), input));
      setTimeout(() => input.focus(), 60);
      return { input };
    },
    actions: ({ input }) => [
      ['取消', 'ghost', closeModal],
      ['创建', 'primary', async () => {
        const name = input.value.trim();
        if (!name) return input.focus();
        try {
          await api.mkdir(state.dir, name);
          closeModal();
          toast('文件夹已创建');
          render();
        } catch (err) { toast(err.message, 'error'); }
      }],
    ],
  });
}

function renameEntry(entry) {
  modal({
    title: '重命名',
    body: (body) => {
      const input = el('input', { class: 'input', value: entry.name });
      body.append(el('div', { class: 'field' },
        el('label', { class: 'field__label' }, '新名称'), input));
      setTimeout(() => { input.focus(); input.select(); }, 60);
      return { input };
    },
    actions: ({ input }) => [
      ['取消', 'ghost', closeModal],
      ['保存', 'primary', async () => {
        const name = input.value.trim();
        if (!name || name === entry.name) return closeModal();
        try {
          await api.rename(entry.rel, name);
          closeModal();
          toast('已重命名');
          render();
        } catch (err) { toast(err.message, 'error'); }
      }],
    ],
  });
}

function removeEntries(paths, label) {
  modal({
    title: '删除',
    body: (body) => body.append(
      el('p', { style: { margin: '0', color: 'var(--ink-2)', fontSize: '14px' } },
        paths.length === 1 ? `确定删除「${label}」？` : `确定删除选中的 ${paths.length} 项？`),
      el('p', { style: { margin: '10px 0 0', color: 'var(--ink-3)', fontSize: '12.5px' } },
        '文件会从磁盘上直接移除，无法撤销。')),
    actions: () => [
      ['取消', 'ghost', closeModal],
      ['删除', 'danger', async () => {
        try {
          await api.remove(paths);
          closeModal();
          clearSelection();
          toast('已删除');
          render();
        } catch (err) { toast(err.message, 'error'); }
      }],
    ],
  });
}

async function createShare(paths) {
  try {
    const created = [];
    for (const p of paths) created.push(await api.createShare({ path: p }));
    showShareCreated(created, paths);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showShareCreated(created, paths) {
  const hosts = state.system?.hosts?.length ? state.system.hosts.map((h) => h.url) : [];
  const origin = created[0]?.url || '';
  const suffix = origin.replace(/^https?:\/\/[^/]+/, '');
  const urls = hosts.length ? hosts.map((h) => `${h}${suffix}`) : [origin];
  let url = urls[0];
  modal({
    title: '分享链接已创建',
    body: (body) => {
      const display = el('input', { class: 'input input--mono', value: url, readonly: '' });
      display.addEventListener('focus', () => display.select());
      const qr = el('canvas', { class: 'qr-canvas' });
      drawQr(qr, url);
      body.append(
        el('div', { class: 'qr-panel' }, qr, el('div', { class: 'qr-url' }, url)),
        urls.length > 1
          ? el('div', { class: 'field', style: { marginTop: '16px' } },
              el('label', { class: 'field__label' }, '使用哪个网络地址'),
              el('div', { class: 'seg' }, urls.map((u) => el('button', {
                type: 'button',
                'aria-pressed': String(u === url),
                onclick: (e) => {
                  url = u;
                  display.value = u;
                  $('.qr-url', body).textContent = u;
                  drawQr(qr, u);
                  for (const b of body.querySelectorAll('.seg button')) {
                    b.setAttribute('aria-pressed', String(b === e.currentTarget));
                  }
                },
              }, u.replace(/^https?:\/\//, '').replace(/:\d+$/, '')))))
          : null,
        el('div', { class: 'field', style: { marginTop: '16px' } },
          el('label', { class: 'field__label' }, '链接'),
          display),
        created.length > 1
          ? el('p', { class: 'field__hint' }, `已为 ${created.length} 个项目各创建一条链接，列表里可以逐一查看。`)
          : el('p', { class: 'field__hint' }, '同一个局域网内的设备打开即可下载，无需登录。'));
      return { display };
    },
    actions: ({ display }) => [
      ['完成', 'ghost', closeModal],
      ['复制链接', 'primary', async () => {
        await copyText(display.value);
        toast('链接已复制');
      }],
    ],
  });
  render();
}

function showQr(share) {
  modal({
    title: '扫码打开',
    body: (body) => {
      const qr = el('canvas', { class: 'qr-canvas' });
      drawQr(qr, share.url);
      body.append(el('div', { class: 'qr-panel' }, qr, el('div', { class: 'qr-url' }, share.url)));
      return {};
    },
    actions: () => [
      ['关闭', 'ghost', closeModal],
      ['复制链接', 'primary', async () => { await copyText(share.url); toast('链接已复制'); }],
    ],
  });
}

/* ---------------------------------------------------------------- preview */

function preview(entry) {
  const kind = entry.kind;
  const canPreview = ['image', 'video', 'audio', 'pdf', 'text'].includes(kind);
  if (!canPreview) {
    if (kind === 'archive' || kind === 'doc' || kind === 'file') {
      triggerDownload(downloadUrl(entry.rel), entry.name);
      return;
    }
  }

  const overlay = el('div', { class: 'overlay is-open' });
  const modalEl = el('div', { class: 'modal modal--preview' },
    el('div', { class: 'modal__head' },
      el('div', { class: 'modal__title' }, entry.name,
        el('span', { class: 'modal__sub' }, `${humanSize(entry.size)} · ${fmtDate(entry.mtime)}`)),
      el('button', { class: 'btn btn--quiet btn--icon', 'aria-label': '关闭' }, icon('x', 18))),
    el('div', { class: 'preview' },
      el('div', { class: 'preview__stage' }),
      el('div', { class: 'preview__nav' },
        el('button', { class: 'btn btn--ghost btn--sm' }, icon('download', 16), '下载'),
        el('div', { class: 'preview__name' }, entry.rel),
        el('div', { class: 'preview__meta' }, kind.toUpperCase()))));
  overlay.append(modalEl);
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';

  const stage = modalEl.querySelector('.preview__stage');
  const url = previewUrl(entry.rel);
  if (kind === 'image') {
    stage.append(el('img', { src: url, alt: entry.name }));
  } else if (kind === 'video') {
    stage.append(el('video', { src: url, controls: '', playsinline: '', autoplay: '' }));
  } else if (kind === 'audio') {
    stage.append(el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center' } },
      el('div', { style: { color: 'var(--ink-3)' } }, icon('audio', 56, 1.3)),
      el('audio', { src: url, controls: '', autoplay: '', style: { width: 'min(420px, 70vw)' } })));
  } else if (kind === 'pdf') {
    stage.append(el('iframe', { src: url, title: entry.name }));
  } else if (kind === 'text') {
    const pre = el('pre', { class: 'preview__text' }, '正在加载…');
    stage.append(pre);
    fetch(url).then((r) => r.text()).then((text) => {
      pre.textContent = text.slice(0, 2_000_000);
      if (text.length > 2_000_000) pre.textContent += '\n\n… 文件过大，仅显示前 2 MB';
    }).catch(() => { pre.textContent = '无法预览此文件'; });
  }

  modalEl.querySelector('.preview__nav .btn').onclick = () => triggerDownload(downloadUrl(entry.rel), entry.name);
  function close() {
    overlay.remove();
    if (!$('#overlay').classList.contains('is-open')) document.body.style.overflow = '';
    removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  modalEl.querySelector('.modal__head .btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  addEventListener('keydown', onKey);
}

/* -------------------------------------------------------------------- zip */

async function zipDownload(paths) {
  toast('正在打包…');
  try {
    const res = await fetch('/api/download-zip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '打包失败');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const name = paths.length === 1
      ? `${paths[0].split('/').pop()}.zip`
      : `LanShare-${new Date().toISOString().slice(0, 10)}.zip`;
    triggerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ------------------------------------------------------------------- modal */

let modalState = null;

function modal({ title, body, actions, wide = false }) {
  const overlay = $('#overlay');
  const modalEl = $('#modal');
  $('#modalTitle').textContent = title;
  modalEl.className = `modal${wide ? ' modal--wide' : ''}`;
  const bodyEl = $('#modalBody');
  const footEl = $('#modalFoot');
  bodyEl.replaceChildren();
  footEl.replaceChildren();

  document.body.style.overflow = 'hidden';
  overlay.classList.add('is-open');
  bodyEl.classList.remove('modal__body--flush');

  const shown = body(bodyEl) || {};
  for (const [label, style, handler] of actions(shown)) {
    footEl.append(el('button', {
      class: `btn btn--${style}`,
      onclick: () => handler(shown),
    }, label));
  }
  modalState = { overlay };
  setTimeout(() => bodyEl.querySelector('input')?.focus(), 80);
}

function closeModal() {
  $('#overlay').classList.remove('is-open');
  document.body.style.overflow = '';
  modalState = null;
}

$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeModal();
});
$('#modalClose').addEventListener('click', closeModal);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#overlay').classList.contains('is-open')) closeModal();
});

/* ----------------------------------------------------------------- toaster */

function makeToaster() {
  const host = $('#toasts');
  return function toast(message, kind = 'ok') {
    const node = el('div', { class: 'toast', dataset: { kind } },
      icon(kind === 'error' ? 'alert' : 'check', 15), message);
    host.append(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 240);
    }, kind === 'error' ? 4200 : 2400);
  };
}

/* ------------------------------------------------------------- transfers UI */

const transfersPanel = $('#transfers');
const transfersList = $('#transfersList');
let collapsed = false;

onTransfer((jobs) => {
  const active = jobs.filter((j) => j.state === 'uploading' || j.state === 'queued');
  const visible = jobs.slice(0, 30);

  if (!jobs.length) {
    transfersPanel.classList.remove('is-open');
    return;
  }
  if (active.length) {
    transfersPanel.classList.add('is-open');
    collapsed = false;
  } else if (jobs.every((j) => j.state === 'done')) {
    // Everything landed: get out of the way so the listing is readable.
    setTimeout(() => { if (!collapsed) transfersPanel.classList.remove('is-open'); }, 1800);
  }

  const totalPct = jobs.length
    ? Math.round(jobs.reduce((s, j) => s + j.progress, 0) / jobs.length * 100)
    : 0;
  $('#transfersTitle').textContent = active.length
    ? `传输队列 · ${active.length} 进行中`
    : `传输队列 · ${totalPct}%`;

  $('#readout').classList.toggle('is-active', active.length > 0);
  const speed = active.reduce((s, j) => s + (j.speed || 0), 0);
  $('#linkSpeed').textContent = active.length
    ? `${humanSize(speed)}/s`
    : '空闲';

  transfersList.replaceChildren(...visible.map((job) => {
    const pct = Math.round(job.progress * 100);
    const stateText = {
      queued: '等待中',
      uploading: job.eta ? `${humanTime(job.eta)} 剩余` : '传输中',
      done: '已完成',
      error: job.error || '失败',
      canceled: '已取消',
    }[job.state];
    const row = el('div', { class: 'titem', dataset: { state: job.state } },
      el('div', { class: 'titem__top' },
        el('div', { class: 'titem__name', title: job.name }, job.name),
        el('div', { class: 'titem__pct' }, job.state === 'done' ? '✓' : `${pct}%`),
        el('button', {
          class: 'titem__x',
          'aria-label': '移除',
          onclick: () => {
            if (job.state === 'uploading' || job.state === 'queued') cancelJob(job);
            else jobs.splice(jobs.indexOf(job), 1);
          },
        }, icon('x', 13))),
      el('div', { class: 'titem__bar' },
        el('div', { class: 'titem__fill', style: { width: `${job.state === 'done' ? 100 : pct}%` } })),
      el('div', { class: 'titem__foot' },
        el('span', {}, `${humanSize(job.loaded)} / ${humanSize(job.size)}`),
        job.state === 'uploading' && job.speed ? el('span', {}, `${humanSize(job.speed)}/s`) : null,
        el('span', { class: 'titem__state' }, stateText)));
    return row;
  }));

  if (jobs.some((j) => j.state === 'done') && !active.length) {
    // Refresh the listing once uploads settle, so new files appear.
    if (state.route === 'files') {
      clearTimeout(window.__refreshTimer);
      window.__refreshTimer = setTimeout(() => render(), 400);
    }
  }
});

$('#transfersClose').onclick = () => {
  collapsed = true;
  transfersPanel.classList.remove('is-open');
  clearFinished();
};
$('#transfersToggle').onclick = (e) => {
  const list = $('#transfersList');
  const hidden = list.style.display === 'none';
  list.style.display = hidden ? '' : 'none';
  e.currentTarget.textContent = hidden ? '收起' : '展开';
};

/* ------------------------------------------------------------- chrome wiring */

function bindChrome() {
  $('#uploadBtn').onclick = () => $('#fileInput').click();
  $('#mobileUpload').onclick = () => $('#fileInput').click();
  $('#newFolderBtn').onclick = newFolder;

  $('#fileInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    enqueue(files, state.dir);
    transfersPanel.classList.add('is-open');
  });

  $('#folderInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    // Flatten the folder selection into the current directory.
    enqueue(files.map(flattenFile), state.dir);
    transfersPanel.classList.add('is-open');
  });

  $('#search').addEventListener('input', debounce((e) => {
    state.query = e.target.value;
    if (state.route === 'files' && state.entries.length) paintFiles();
  }, 120));

  $('#viewList').onclick = () => setView('list');
  $('#viewGrid').onclick = () => setView('grid');

  $('#bulkDownload').onclick = () => zipDownload([...state.selection]);
  $('#bulkShare').onclick = () => createShare([...state.selection]);
  $('#bulkDelete').onclick = () => removeEntries([...state.selection], `${state.selection.size} 项`);
  $('#bulkClear').onclick = clearSelection;

  for (const btn of $$('[data-route]')) {
    btn.addEventListener('click', () => go(btn.dataset.route));
  }

  $('#themeToggle').onclick = toggleTheme;

  addEventListener('scroll', () => {
    $('#topbar').classList.toggle('is-scrolled', scrollY > 4);
  }, { passive: true });

  // Drag & drop from the OS
  let dragDepth = 0;
  addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragDepth++;
    document.body.classList.add('is-dragging');
  });
  addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragging');
  });
  addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  addEventListener('drop', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
    const files = [...e.dataTransfer.files];
    if (files.length) {
      enqueue(files, state.dir);
      transfersPanel.classList.add('is-open');
    }
  });

  addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea')) return;
    if (e.key === 'Escape') clearSelection();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && state.route === 'files') {
      const onFiles = !document.body.classList.contains('is-dragging');
      if (!onFiles) return;
      e.preventDefault();
      for (const entry of state.entries) toggleSelect(entry.rel, true);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      $('#fileInput').click();
    }
  });
}

function flattenFile(file) {
  // Keep the leaf name; webkitRelativePath folders are flattened intentionally.
  return file;
}

function setView(mode) {
  state.view = mode;
  localStorage.setItem('ls:view', mode);
  $('#viewList').setAttribute('aria-pressed', String(mode === 'list'));
  $('#viewGrid').setAttribute('aria-pressed', String(mode === 'grid'));
  if (state.route === 'files' && state.entries.length) paintFiles();
}

/* -------------------------------------------------------------------- theme */

function initTheme() {
  const saved = localStorage.getItem('ls:theme');
  const theme = saved || 'dark';
  document.documentElement.dataset.theme = theme;
  updateThemeLabel(theme);
  if (state.view === 'list') {
    $('#viewList').setAttribute('aria-pressed', 'true');
    $('#viewGrid').setAttribute('aria-pressed', 'false');
  } else {
    $('#viewList').setAttribute('aria-pressed', 'false');
    $('#viewGrid').setAttribute('aria-pressed', 'true');
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('ls:theme', next);
  updateThemeLabel(next);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = next === 'dark' ? '#16181b' : '#f6f5f2';
}

function updateThemeLabel(theme) {
  $('#themeLabel').textContent = theme === 'dark' ? '浅色模式' : '深色模式';
}

/* ---------------------------------------------------------------------- QR */

let qrCode = null;

function drawQr(canvas, text) {
  import('./qr.js').then((mod) => {
    const { Qr } = mod;
    const qr = Qr.encode(text, 'M');
    const modules = qr.size;
    const scale = Math.max(1, Math.floor(400 / modules));
    const px = modules * scale;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#111';
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if (qr.get(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }).catch(() => {});
}
