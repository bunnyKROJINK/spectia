// Spectia — главный файл интерфейса.
//
// Как это устроено:
//  • Всё, что видно на экране, описано в объекте `state`.
//  • Функции view* превращают state в HTML.
//  • Кнопки помечены data-action="…", а их обработчики лежат в объекте `actions`.
//  • Поля ввода помечены data-bind="путь.в.state" и сами записывают туда значение.

import { api, win, openUrl, inApp, on, onFileDrop, fileUrl } from './api.js';
import { renderDecorations } from './decorations.js';
import { t, setLang, LANGS, formatNumber } from './i18n.js';
import { THEMES, THEME_ORDER, TINTS } from './themes.js';
import { applyAppearance, applyZoom, resolveTheme, themeFromColors, lum as lumOf } from './appearance.js';
import { chime } from './sound.js';
import { skinCanvas, paintSkins } from './skinview.js';
import { icon, heroArt } from './icons.js';
import { searchModrinth } from './modrinth.js';
import { matchScore } from './search.js';

const APP_VERSION = '0.5.0';
const REPO_URL = 'https://github.com/bunnyKROJINK/spectia';
const LOADERS = ['vanilla', 'fabric', 'neoforge', 'forge', 'quilt'];
const RES_KINDS = ['mod', 'shader', 'resourcepack', 'datapack', 'modpack'];
const NAV = [
  { id: 'home', view: 'home' },
  { id: 'instances', view: 'instances' },
  { id: 'resources', view: 'resources' },
  { id: 'skins', view: 'skins' },
  { id: 'settings', view: 'settings' },
];
// Каким пунктом меню подсвечивать каждый экран
const NAV_OF_VIEW = { home: 'home', instances: 'instances', create: 'instances', instance: 'instances', resources: 'resources', skins: 'skins', settings: 'settings', accounts: '' };

const state = {
  view: 'home',
  back: 'home',
  settings: null,
  instances: [],
  selectedId: null,
  versions: null,          // { latest, versions } с серверов Mojang
  versionsError: false,
  create: { mode: 'scratch', name: '', version: '', loader: 'fabric', loaderVersion: '', tint: 0, snapshots: false },
  edit: null,              // копия сборки, которую сейчас настраиваем
  instTab: 'general',      // вкладка в настройках сборки: general | mods | launch
  editSnapshots: false,
  advOpen: false,
  loaderVersions: {},      // "fabric:26.3" → список версий загрузчика
  mods: { id: null, list: null, loading: false, query: '', dragging: false },
  ctx: null,               // меню по правой кнопке: { id, x, y }
  worlds: { id: null, list: null },
  shots: { id: null, list: null },
  dataDir: '',             // папка с данными лаунчера (для картинок обложек)
  importing: null,         // { done, total } пока импортируется .mrpack
  res: { query: '', kind: 'mod', source: 'modrinth', results: null, loading: false, error: false, targetId: null, installing: {}, installed: new Set(), installedFor: null },
  skins: { account: null, accountFor: null, library: null, pick: null, busy: false },
  tagDraft: '',
  instFilter: 'all',       // all | fav | archive | folder:… | tag:…
  msReady: false,          // настроен ли вход через Microsoft в этой сборке лаунчера
  msBusy: false,
  setTab: 'look',          // вкладка настроек
  dp: { world: null, list: null }, // датапаки раскрытого мира
  backups: { id: null, list: null },
  accounts: [],
  ely: { username: '', password: '', totp: '', need2fa: false, busy: false, error: '' },
  running: new Set(),      // id запущенных сборок
  progress: {},            // id → { stage, done, total } пока идёт подготовка к запуску
  update: null,            // { version, currentVersion, notes } если вышла новая версия
  updating: null,          // { downloaded, total } пока качается обновление
  dialog: null,
  toast: null,
};

// ---------- Маленькие помощники ----------

const $ = (sel) => document.querySelector(sel);

/** Экранирует текст, чтобы название вроде <b> не сломало страницу. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const selected = () => state.instances.find((i) => i.id === state.selectedId) || visibleInstances()[0] || state.instances[0] || null;
/** Сборки без архива, избранные — первыми */
const visibleInstances = () => state.instances.filter((i) => !i.archived).sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

// Цветные теги: цвет зависит от текста тега, поэтому один и тот же тег всегда одного цвета
const TAG_COLORS = ['#FF8CC6', '#8B9CFF', '#4ADE9A', '#FF9A3C', '#FF6B78', '#4FD8E8', '#B78CFF', '#FFD166'];
function tagColor(tag) {
  let h = 0;
  for (const c of String(tag).toLowerCase()) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
const tagChip = (tag, removable = false) => `<span class="tag" style="--tag:${tagColor(tag)}">${esc(tag)}${removable
  ? `<button type="button" data-action="removeTag" data-tag="${esc(tag)}" aria-label="${esc(t('org.removeTag', { tag }))}">×</button>` : ''}</span>`;
const activeAccount = () => state.accounts.find((a) => a.active) || null;
const loaderLabel = (id) => (id === 'vanilla' ? t('loader.none') : t('loader.' + id));
const tint = (n) => TINTS[n] || TINTS[0];

/** Путь к своей картинке-обложке сборки (если есть) */
function coverUrl(inst) {
  if (!inst?.coverImage || !state.dataDir) return '';
  const sep = state.dataDir.includes('\\') ? '\\' : '/';
  return fileUrl([state.dataDir, 'instances', inst.id, inst.coverImage].join(sep));
}

/** Фон обложки: картинка, если выбрана, иначе цветной градиент */
function coverBg(inst, shade = false) {
  const url = coverUrl(inst);
  if (!url) return `background:${tint(inst?.tint)}`;
  const dark = shade ? 'linear-gradient(0deg, rgba(8,8,22,.35), rgba(8,8,22,.05)), ' : '';
  return `background:${dark}url("${url}") center/cover no-repeat, ${tint(inst.tint)}`;
}
const pressed = (on) => `aria-pressed="${on ? 'true' : 'false'}"`;

function getPath(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), state);
}
function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const obj = keys.reduce((o, k) => o[k], state);
  obj[last] = value;
}

let toastTimer;
function toast(text, error = false) {
  state.toast = { text, error };
  renderOverlay();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; renderOverlay(); }, error ? 6000 : 3500);
}

function go(view, extra = {}) {
  state.back = state.view;
  Object.assign(state, { view }, extra);
  render(true);
}

async function saveSettings() {
  try { await api.saveSettings(state.settings); } catch (e) { toast(t('error.generic', { message: e }), true); }
}

function applySettings() {
  setLang(state.settings.language);
  const theme = applyAppearance(state.settings);
  renderDecorations(theme.deco, state.settings.showDecorations !== false);
  document.documentElement.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  applyZoom(state.settings.uiScale || 1);
}

/** Колокольчик и уведомление Windows (если лаунчер сейчас не в фокусе). */
function celebrate(kind, title, body) {
  const s = state.settings || {};
  if (s.sound !== false) chime(kind, (s.soundVolume ?? 60) / 100);
  if (s.notifications !== false && !document.hasFocus()) api.notify(title, body).catch(() => {});
}

async function loadInstances() {
  state.instances = await api.listInstances();
  if (!state.instances.some((i) => i.id === state.selectedId)) state.selectedId = state.instances[0]?.id ?? null;
}

async function loadVersions() {
  state.versionsError = false;
  try {
    state.versions = await api.getVersions();
    if (!state.create.version) state.create.version = state.versions.latest.release;
  } catch {
    state.versionsError = true;
  }
  if (state.view === 'create') render();
}

// ---------- Общие кусочки разметки ----------

function switchRow(action, key, on, title, sub) {
  return `<button class="switch-row" role="switch" aria-checked="${on ? 'true' : 'false'}" data-action="${action}" data-key="${key}">
    <span class="stack" style="gap:2px"><span>${esc(title)}</span>${sub ? `<span class="small muted">${esc(sub)}</span>` : ''}</span>
    <span class="switch"></span>
  </button>`;
}

function pageHead(title, backAction) {
  return `<div class="row" style="gap:14px">
    ${backAction ? `<button class="icon-btn" data-action="${backAction}" aria-label="${esc(t('common.back'))}">${icon.back()}</button>` : ''}
    <h1 class="page-title" style="${backAction ? 'margin:0' : ''}">${esc(title)}</h1>
  </div>`;
}

// ---------- Кнопка «Играть» ----------

function playButton(id) {
  if (state.running.has(id)) {
    return `<button class="play" data-action="stop" data-id="${esc(id)}" style="background:rgba(255,255,255,.14);color:#fff;box-shadow:none">
      <span class="pulse"></span><span>${esc(t('launch.stop'))}</span></button>`;
  }
  const p = state.progress[id];
  if (p) {
    return `<button class="play" disabled style="cursor:default"><span class="spinner" style="border-color:rgba(0,0,0,.2);border-top-color:currentColor"></span><span>${esc(t('home.launching'))}</span></button>`;
  }
  return `<button class="play" data-action="play" data-id="${esc(id)}">${icon.play()}<span>${esc(t('home.play'))}</span></button>`;
}

function progressBar(id) {
  const p = state.progress[id];
  if (state.running.has(id)) {
    return `<div class="launch-status"><span class="pulse"></span>${esc(t('launch.running'))}</div>`;
  }
  if (!p) return '';
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const counted = ['java', 'libraries', 'assets'].includes(p.stage) && p.total > 1;
  return `<div class="launch-status">
    <div class="row between" style="width:100%">
      <span>${esc(t('launch.stage.' + p.stage))}${counted ? ` ${p.done} / ${p.total}` : ''}</span>
      ${counted ? `<span>${pct}%</span>` : ''}
    </div>
    <div class="bar"><span style="width:${counted ? pct : 100}%" class="${counted ? '' : 'indeterminate'}"></span></div>
    ${p.stage === 'assets' || p.stage === 'java' ? `<span class="small" style="opacity:.8">${esc(t('launch.firstTime'))}</span>` : ''}
  </div>`;
}

// ---------- Экраны ----------

function viewHome() {
  const cur = selected();
  if (!cur) {
    return `<div class="view">
      <section class="hero" style="background:${TINTS[0]}">${heroArt}
        <div class="hero-inner">
          <div class="stack" style="gap:10px;max-width:520px">
            <span class="eyebrow">Spectia</span>
            <h1>${esc(t('home.emptyTitle'))}</h1>
            <p style="color:#D9DCF2;line-height:1.5">${esc(t('home.emptySub'))}</p>
          </div>
          <button class="play" data-action="openCreate">${esc(t('home.newInstance'))}</button>
        </div>
      </section>
      ${findBlock()}
    </div>`;
  }
  return `<div class="view">
    <section class="hero" aria-label="${esc(cur.name)}" style="${coverBg(cur, true)}">${coverUrl(cur) ? '' : heroArt}
      <div class="hero-inner">
        <div class="stack" style="gap:10px;min-width:0">
          <span class="eyebrow">${esc(t('home.continue'))}</span>
          <h1 class="ellipsis">${esc(cur.name)}</h1>
          <div class="row" style="gap:8px">
            <span class="chip">Minecraft ${esc(cur.gameVersion)}</span>
            <span class="chip">${esc(loaderLabel(cur.loader))}</span>
            <span class="chip">${esc(t('home.ram', { gb: cur.memoryGb }))}</span>
            ${cur.playTimeSecs ? `<span class="chip">${esc(t('home.played', { t: formatPlayTime(cur.playTimeSecs) }))}</span>` : ''}
          </div>
        </div>
        <div class="row">
          <button class="icon-btn" data-action="openFolder" data-id="${esc(cur.id)}" aria-label="${esc(t('is.openFolder'))}" title="${esc(t('is.openFolder'))}">${icon.folder(20)}</button>
          <button class="icon-btn" data-action="openInstance" data-id="${esc(cur.id)}" aria-label="${esc(t('home.instanceSettings'))}" title="${esc(t('home.instanceSettings'))}">${icon.gear()}</button>
          ${playButton(cur.id)}
        </div>
      </div>
      ${progressBar(cur.id)}
    </section>

    <section class="panel pad-s stack" style="gap:12px" aria-label="${esc(t('home.myInstances'))}">
      <div class="row between">
        <h2 class="h2-lg">${esc(t('home.myInstances'))}</h2>
        <div class="row" style="gap:8px">
          <button class="btn sm" data-action="nav" data-view="instances">${esc(t('home.allInstances'))}</button>
          <button class="btn sm soft" data-action="openCreate">${esc(t('home.newInstance'))}</button>
        </div>
      </div>
      <div class="grid grid-cards">
        ${visibleInstances().slice(0, 8).map((i) => `
          <button class="card" data-action="select" data-id="${esc(i.id)}" data-ctx="${esc(i.id)}" ${pressed(i.id === cur.id)}>
            <span class="cover" style="${coverBg(i)}"></span>${i.favorite ? `<span class="fav" aria-label="${esc(t('org.favorite'))}">${icon.star(16).replace('fill="none"', 'fill="currentColor"')}</span>` : ''}
            <span class="card-title ellipsis" style="max-width:100%">${esc(i.name)}</span>
            <span class="small muted">${esc(i.gameVersion)} · ${esc(loaderLabel(i.loader))}</span>
          </button>`).join('')}
      </div>
    </section>
    ${findBlock()}
  </div>`;
}

function findBlock() {
  return `<section class="panel pad-s row between" style="gap:14px">
    <div class="stack" style="gap:4px">
      <h2 class="h2-lg">${esc(t('home.findTitle'))}</h2>
      <span class="note">${esc(t('home.findSub'))}</span>
    </div>
    <button class="btn accent" data-action="nav" data-view="resources">${esc(t('common.openCatalog'))}</button>
  </section>`;
}

function instanceRow(i) {
  return `
    <div class="list-row ${i.archived ? 'archived' : ''}" data-ctx="${esc(i.id)}">
      <button class="icon-btn star" style="width:36px;height:36px;border:0;background:transparent" data-action="toggleFavorite" data-id="${esc(i.id)}" ${pressed(i.favorite)}
        aria-label="${esc(t(i.favorite ? 'org.unfavorite' : 'org.favorite'))}" title="${esc(t(i.favorite ? 'org.unfavorite' : 'org.favorite'))}">${icon.star()}</button>
      <span class="thumb" style="${coverBg(i)}"></span>
      <div class="stack grow" style="gap:4px">
        <span class="row" style="gap:8px"><span class="card-title ellipsis">${esc(i.name)}</span>${(i.tags || []).map((g) => tagChip(g)).join('')}</span>
        <span class="small muted">Minecraft ${esc(i.gameVersion)} · ${esc(loaderLabel(i.loader))} · ${esc(formatPlayTime(i.playTimeSecs))}</span>
        ${i.notes ? `<span class="small muted ellipsis" style="max-width:560px;opacity:.85">${icon.note(12)} ${esc(i.notes.split('\n')[0])}</span>` : ''}
      </div>
      <div class="row" style="gap:8px">
        <button class="icon-btn" data-action="openInstance" data-id="${esc(i.id)}" aria-label="${esc(t('home.instanceSettings'))}" title="${esc(t('home.instanceSettings'))}">${icon.gear(18)}</button>
        <button class="icon-btn" data-action="openFolder" data-id="${esc(i.id)}" aria-label="${esc(t('inst.openFolder'))}" title="${esc(t('inst.openFolder'))}">${icon.folder()}</button>
        ${i.archived
          ? `<button class="btn" style="height:40px" data-action="toggleArchive" data-id="${esc(i.id)}">${icon.restore()}<span>${esc(t('org.unarchive'))}</span></button>`
          : state.running.has(i.id)
            ? `<button class="btn" style="height:40px" data-action="stop" data-id="${esc(i.id)}">${esc(t('launch.stop'))}</button>`
            : `<button class="btn accent" style="height:40px" data-action="playInstance" data-id="${esc(i.id)}" ${state.progress[i.id] ? 'disabled' : ''}>${esc(t('inst.play'))}</button>`}
      </div>
    </div>`;
}

const allFolders = () => [...new Set(state.instances.map((i) => (i.folder || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const allTags = () => [...new Set(state.instances.flatMap((i) => i.tags || []))].sort((a, b) => a.localeCompare(b));

function viewInstances() {
  const f = state.instFilter;
  const folders = allFolders();
  const tags = allTags();
  const archived = state.instances.filter((i) => i.archived);
  let list = visibleInstances();
  if (f === 'fav') list = list.filter((i) => i.favorite);
  else if (f === 'archive') list = archived;
  else if (f.startsWith('folder:')) list = list.filter((i) => (i.folder || '').trim() === f.slice(7));
  else if (f.startsWith('tag:')) list = list.filter((i) => (i.tags || []).includes(f.slice(4)));

  // В «Все» раскладываем по папкам; сборки без папки — сверху
  let rows;
  if (f === 'all' && folders.length) {
    const groups = [['', list.filter((i) => !(i.folder || '').trim())], ...folders.map((n) => [n, list.filter((i) => (i.folder || '').trim() === n)])];
    rows = groups.filter(([, l]) => l.length).map(([n, l]) => (n ? `<div class="folder-head">${icon.folder(14)}<span>${esc(n)}</span></div>` : '') + l.map(instanceRow).join('')).join('');
  } else {
    rows = list.map(instanceRow).join('');
  }

  const pill = (id, label, ic = '') => `<button class="pill row" style="gap:6px;flex-wrap:nowrap" data-action="setInstFilter" data-f="${esc(id)}" ${pressed(f === id)}>${ic}<span>${esc(label)}</span></button>`;
  const filters = state.instances.length ? `<div class="row" style="gap:6px" role="group" aria-label="${esc(t('org.filter'))}">
      ${pill('all', t('org.all'))}
      ${state.instances.some((i) => i.favorite) ? pill('fav', t('org.favorites'), icon.star(14)) : ''}
      ${folders.map((n) => pill('folder:' + n, n, icon.folder(14))).join('')}
      ${tags.map((g) => `<button class="pill" data-action="setInstFilter" data-f="${esc('tag:' + g)}" ${pressed(f === 'tag:' + g)} style="border-color:${tagColor(g)}66">${esc(g)}</button>`).join('')}
      ${archived.length ? pill('archive', t('org.archive', { n: archived.length }), icon.archive(14)) : ''}
    </div>` : '';

  return `<div class="view">
    <div class="row between">
      <h1 class="page-title">${esc(t('inst.title'))}</h1>
      <div class="row" style="gap:8px">
        <button class="btn" data-action="openPrism">${icon.move()}<span>${esc(t('prism.button'))}</span></button>
        <button class="btn" data-action="importPack">${icon.upload(16)}<span>${esc(t('inst.import'))}</span></button>
        <button class="btn accent" data-action="openCreate">${esc(t('home.newInstance'))}</button>
      </div>
    </div>
    ${filters}
    ${state.instances.length
      ? list.length
        ? `<section class="panel list">${rows}</section>`
        : `<section class="panel empty"><span class="muted">${esc(t(f === 'archive' ? 'org.archiveEmpty' : 'org.filterEmpty'))}</span></section>`
      : `<section class="panel empty">${icon.box()}<h2 class="h2">${esc(t('inst.empty'))}</h2>
           <p class="note">${esc(t('prism.emptyHint'))}</p>
           <div class="row"><button class="btn" data-action="openPrism">${icon.move()}<span>${esc(t('prism.button'))}</span></button>
           <button class="btn accent" data-action="openCreate">${esc(t('home.newInstance'))}</button></div></section>`}
  </div>`;
}

/** Список версий Minecraft. bind — куда записывать выбор (create.version или edit.gameVersion). */
function versionOptions(bind, current, snapshots, change = '') {
  if (state.versionsError) {
    return `<div class="row"><span class="warn">${esc(t('create.versionsError'))}</span>
      <button class="btn sm" data-action="retryVersions">${esc(t('create.retry'))}</button></div>`;
  }
  if (!state.versions) return `<div class="row"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  const list = state.versions.versions.filter((v) => v.kind === 'release' || (snapshots && v.kind === 'snapshot') || v.id === current);
  const id = bind.replace('.', '-');
  return `<label for="${id}" class="sr">${esc(t('create.version'))}</label>
    <select id="${id}" class="input" style="flex:1 1 220px" data-bind="${bind}" ${change ? `data-change="${change}"` : ''}>
      ${list.map((v) => `<option value="${esc(v.id)}" ${v.id === current ? 'selected' : ''}>${esc(v.id === state.versions.latest.release ? t('create.latest', { id: v.id }) : v.id)}</option>`).join('')}
    </select>`;
}

/** Список версий загрузчика (Fabric, Forge…) для выбранной версии игры. */
function loaderVersionSelect(loader, game, bind, current) {
  if (loader === 'vanilla' || !game) return '';
  const key = loader + ':' + game;
  const list = state.loaderVersions[key];
  if (list === undefined) fetchLoaderVersions(loader, game);
  let body;
  if (list === undefined || list === 'loading') {
    body = `<div class="row"><span class="spinner"></span><span class="muted">${esc(t('loaderver.loading'))}</span></div>`;
  } else if (list === 'error') {
    body = `<div class="row"><span class="warn">${esc(t('loaderver.error'))}</span>
      <button class="btn sm" data-action="retryLoaderVersions" data-key="${esc(key)}">${esc(t('create.retry'))}</button></div>`;
  } else if (!list.length) {
    body = `<span class="warn">${esc(t('loaderver.none', { loader: t('loader.' + loader) }))}</span>`;
  } else {
    const rec = list.find((v) => v.recommended) || list[0];
    const label = (v) => (v.recommended ? t('loaderver.recommended', { v: v.version }) : v.stable ? v.version : t('loaderver.beta', { v: v.version }));
    body = `<select id="${bind.replace('.', '-')}" class="input" data-bind="${bind}">
      <option value="" ${!current ? 'selected' : ''}>${esc(label(rec))}</option>
      ${list.filter((v) => v !== rec).map((v) => `<option value="${esc(v.version)}" ${v.version === current ? 'selected' : ''}>${esc(label(v))}</option>`).join('')}
      ${current && !list.some((v) => v.version === current) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : ''}
    </select>`;
  }
  return `<div class="field" style="max-width:420px">
    <label for="${bind.replace('.', '-')}" class="label">${esc(t('create.loaderVersion'))}</label>${body}</div>`;
}

async function fetchLoaderVersions(loader, game) {
  const key = loader + ':' + game;
  state.loaderVersions[key] = 'loading';
  try {
    state.loaderVersions[key] = await api.getLoaderVersions(loader, game);
  } catch {
    state.loaderVersions[key] = 'error';
  }
  if (state.view === 'create' || state.view === 'instance') render();
}

function loaderCards(current, action) {
  return `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px" role="group" aria-label="${esc(t('create.loader'))}">
    ${LOADERS.map((l) => `<button class="card loader-card" data-action="${action}" data-loader="${l}" ${pressed(l === current)}>
      <span class="card-title">${esc(t('loader.' + l))}</span>
      <span class="small muted" style="line-height:1.4">${esc(t('loader.' + l + '.hint'))}</span>
    </button>`).join('')}
  </div>`;
}

function tintButtons(current, action) {
  return TINTS.map((g, n) => `<button class="tint-btn" style="background:${g}" data-action="${action}" data-n="${n}" ${pressed(n === current)} aria-label="${esc(t('create.coverN', { n: n + 1 }))}"></button>`).join('');
}

function formatPlayTime(secs) {
  if (!secs) return t('time.none');
  if (secs < 60) return t('time.lessMin');
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? t('time.h', { h, m }) : t('time.min', { m });
}

function viewCreate() {
  const c = state.create;
  const scratch = `
    <section class="panel pad row" style="gap:18px;align-items:flex-end">
      <span class="thumb" style="width:72px;height:72px;border-radius:14px;background:${tint(c.tint)}"></span>
      <div class="field" style="flex:1 1 240px">
        <label for="iname" class="label">${esc(t('create.name'))}</label>
        <input id="iname" class="input" type="text" maxlength="60" placeholder="${esc(t('create.namePlaceholder'))}" value="${esc(c.name)}" data-bind="create.name">
      </div>
      <div class="field">
        <span class="label">${esc(t('create.cover'))}</span>
        <div class="row" style="gap:6px" role="group" aria-label="${esc(t('create.cover'))}">
          ${tintButtons(c.tint, 'setTint')}
        </div>
      </div>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('create.version'))}</h2>
      <div class="row">
        ${versionOptions('create.version', c.version, c.snapshots, 'createVersion')}
        <button class="row" role="switch" aria-checked="${c.snapshots}" data-action="toggleSnapshots" style="gap:10px;min-height:44px;border:0;background:transparent;cursor:pointer">
          <span class="switch"></span><span>${esc(t('create.snapshots'))}</span>
        </button>
      </div>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('create.loader'))}</h2>
      ${loaderCards(c.loader, 'setLoader')}
      ${loaderVersionSelect(c.loader, c.version, 'create.loaderVersion', c.loaderVersion)}
    </section>`;

  const importMode = `
    <div class="grid grid-2">
      <section class="panel dashed empty" style="min-height:220px">${icon.upload()}
        <h2 class="h2">${esc(t('create.dropTitle'))}</h2>
        <p class="note">${esc(t('create.dropSub'))}</p>
        <button class="btn" data-action="importPack">${esc(t('common.chooseFile'))}</button>
      </section>
      <section class="panel empty" style="min-height:220px">${icon.search()}
        <h2 class="h2">${esc(t('create.catalogTitle'))}</h2>
        <p class="note">${esc(t('create.catalogSub'))}</p>
        <button class="btn" data-action="catalogModpacks">${esc(t('common.openCatalog'))}</button>
      </section>
    </div>`;

  return `<div class="view">
    ${pageHead(t('create.title'), 'goBack')}
    <div class="row" style="gap:6px" role="group" aria-label="${esc(t('create.mode'))}">
      <button class="pill" data-action="setCreateMode" data-mode="scratch" ${pressed(c.mode === 'scratch')}>${esc(t('create.scratch'))}</button>
      <button class="pill" data-action="setCreateMode" data-mode="import" ${pressed(c.mode === 'import')}>${esc(t('create.import'))}</button>
    </div>
    ${c.mode === 'scratch' ? scratch : importMode}
    <div class="row" style="justify-content:flex-end">
      <button class="btn" data-action="goBack">${esc(t('common.cancel'))}</button>
      ${c.mode === 'scratch' ? `<button class="btn accent" data-action="createInstance" ${state.versions ? '' : 'disabled'}>${esc(t('common.create'))}</button>` : ''}
    </div>
  </div>`;
}

function viewInstance() {
  const e = state.edit;
  if (!e) return viewInstances();
  const tab = state.instTab;
  const tabs = ['general', 'mods', 'worlds', 'screens', 'launch'].map((k) =>
    `<button role="tab" aria-selected="${tab === k}" data-action="setInstTab" data-tab="${k}">${esc(t('is.tab.' + k))}</button>`).join('');

  let body = '';
  if (tab === 'general') body = instGeneral(e);
  if (tab === 'mods') body = instMods(e);
  if (tab === 'launch') body = instLaunch(e);
  if (tab === 'worlds') body = instWorlds(e);
  if (tab === 'screens') body = instShots(e);

  return `<div class="view">
    <div class="row" style="gap:14px">
      <button class="icon-btn" data-action="goBack" aria-label="${esc(t('common.back'))}">${icon.back()}</button>
      <span class="thumb" style="width:44px;height:44px;${coverBg(e)}"></span>
      <div class="stack grow" style="gap:2px;min-width:0">
        <span class="small muted">${esc(t('is.title'))}</span>
        <h1 class="ellipsis" style="font-size:calc(24px*var(--fs,1));font-weight:700">${esc(e.name || '…')}</h1>
      </div>
      <button class="icon-btn" data-action="openFolder" data-id="${esc(e.id)}" aria-label="${esc(t('is.openFolder'))}" title="${esc(t('is.openFolder'))}">${icon.folder()}</button>
    </div>
    <div class="tabs" role="tablist">${tabs}</div>
    ${body}
    ${tab === 'general' || tab === 'launch' ? `<div class="row" style="justify-content:flex-end">
      <button class="btn" data-action="resetEdit">${esc(t('common.reset'))}</button>
      <button class="btn accent" data-action="saveInstance">${esc(t('common.save'))}</button>
    </div>` : ''}
  </div>`;
}

function instGeneral(e) {
  const last = e.lastPlayed ? new Date(e.lastPlayed * 1000).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long', year: 'numeric' }) : t('is.never');
  return `
    <section class="panel pad row" style="gap:18px;align-items:flex-end">
      <span class="thumb" style="width:72px;height:72px;border-radius:14px;${coverBg(e)}"></span>
      <div class="field" style="flex:1 1 240px">
        <label for="ename" class="label">${esc(t('create.name'))}</label>
        <input id="ename" class="input" type="text" maxlength="60" value="${esc(e.name)}" data-bind="edit.name">
      </div>
      <div class="field">
        <span class="label">${esc(t('create.cover'))}</span>
        <div class="row" style="gap:6px" role="group" aria-label="${esc(t('create.cover'))}">${tintButtons(e.tint, 'setEditTint')}</div>
        <div class="row" style="gap:6px">
          <button class="btn sm" data-action="pickCover" data-id="${esc(e.id)}">${icon.upload(16)}<span>${esc(t('cover.custom'))}</span></button>
          ${e.coverImage ? `<button class="btn sm" data-action="clearCover" data-id="${esc(e.id)}">${esc(t('cover.remove'))}</button>` : ''}
        </div>
      </div>
    </section>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
      <div class="panel pad stack" style="gap:4px"><span class="small muted">${esc(t('is.playTime'))}</span><span class="h2-lg">${esc(formatPlayTime(e.playTimeSecs))}</span></div>
      <div class="panel pad stack" style="gap:4px"><span class="small muted">${esc(t('is.lastPlayed'))}</span><span class="h2-lg">${esc(last)}</span></div>
    </div>

    <section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('create.version'))}</h2>
      <div class="row">${versionOptions('edit.gameVersion', e.gameVersion, state.editSnapshots, 'editVersion')}
        <button class="row" role="switch" aria-checked="${!!state.editSnapshots}" data-action="toggleEditSnapshots" style="gap:10px;min-height:44px;border:0;background:transparent;cursor:pointer">
          <span class="switch"></span><span>${esc(t('create.snapshots'))}</span>
        </button>
      </div>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('create.loader'))}</h2>
      ${loaderCards(e.loader, 'setEditLoader')}
      ${loaderVersionSelect(e.loader, e.gameVersion, 'edit.loaderVersion', e.loaderVersion)}
    </section>

    <section class="panel pad stack" style="gap:14px">
      <h2 class="h2">${esc(t('org.title'))}</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        <div class="field">
          <label for="efolder" class="label">${esc(t('org.folder'))}</label>
          <input id="efolder" class="input" maxlength="40" list="folders-list" placeholder="${esc(t('org.folderPlaceholder'))}" value="${esc(e.folder || '')}" data-bind="edit.folder">
          <datalist id="folders-list">${allFolders().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        </div>
        <form class="field" data-submit="addTag">
          <label for="etag" class="label">${esc(t('org.tags'))}</label>
          <div class="row" style="gap:6px;flex-wrap:nowrap">
            <input id="etag" class="input" maxlength="24" list="tags-list" placeholder="${esc(t('org.tagPlaceholder'))}" value="${esc(state.tagDraft || '')}" data-bind="tagDraft">
            <datalist id="tags-list">${allTags().filter((g) => !(e.tags || []).includes(g)).map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
            <button type="submit" class="btn sm">${esc(t('org.addTag'))}</button>
          </div>
          <div class="row" style="gap:6px">${(e.tags || []).map((g) => tagChip(g, true)).join('') || `<span class="small muted">${esc(t('org.noTags'))}</span>`}</div>
        </form>
      </div>
      <div class="field">
        <label for="enotes" class="label">${esc(t('org.notes'))}</label>
        <textarea id="enotes" class="input" rows="3" maxlength="2000" placeholder="${esc(t('org.notesPlaceholder'))}" data-bind="edit.notes">${esc(e.notes || '')}</textarea>
      </div>
      <div class="grid grid-2" style="gap:4px 16px">
        ${switchRow('toggleEdit', 'favorite', e.favorite, t('org.favorite'))}
        ${switchRow('toggleEdit', 'archived', e.archived, t('org.archived'), t('org.archivedSub'))}
      </div>
    </section>

    <section class="panel pad row between" style="gap:14px">
      <p class="note" style="flex:1 1 320px">${esc(t('is.shareNote'))}</p>
      <button class="btn soft" data-action="share" data-id="${esc(e.id)}">${icon.upload(16)}<span>${esc(t('is.share'))}</span></button>
    </section>

    <div class="row">
      <button class="btn" data-action="duplicate" data-id="${esc(e.id)}">${icon.copy()}<span>${esc(t('is.duplicate'))}</span></button>
      <button class="btn" data-action="askDelete" data-id="${esc(e.id)}" style="color:var(--warn-text)">${icon.trash()}<span>${esc(t('is.delete'))}</span></button>
    </div>`;
}

function instMods(e) {
  if (e.loader === 'vanilla') {
    return `<section class="panel empty">${icon.box()}<p class="note" style="max-width:460px">${esc(t('mods.vanilla'))}</p>
      <button class="btn" data-action="setInstTab" data-tab="general">${esc(t('is.tab.general'))}</button></section>`;
  }
  const m = state.mods;
  if (m.id !== e.id || m.list === null) {
    if (!m.loading) loadMods(e.id);
    return `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  }
  const list = m.list;
  const on = m.list.filter((x) => x.enabled).length;
  const head = `<div class="row between">
      <div class="row" style="flex:1 1 280px">
        <label for="modq" class="sr">${esc(t('mods.search'))}</label>
        <input id="modq" class="input" type="search" style="max-width:320px" placeholder="${esc(t('mods.search'))}" value="${esc(m.query)}" data-bind="mods.query" data-filter-mods>
        <span class="small muted">${esc(t('mods.count', { on, all: m.list.length }))}</span>
      </div>
      <div class="row" style="gap:8px">
        <button class="btn sm" data-action="checkUpdates" data-id="${esc(e.id)}" ${m.checking ? 'disabled' : ''}>${m.checking ? `<span class="spinner"></span>${esc(t('mods.checking'))}` : esc(t('mods.checkUpdates'))}</button>
        <button class="btn sm" data-action="openModsFolder" data-id="${esc(e.id)}">${icon.folder(16)}<span>${esc(t('mods.openFolder'))}</span></button>
        <button class="btn sm soft" data-action="findMods" data-id="${esc(e.id)}">${esc(t('mods.find'))}</button>
      </div>
    </div>`;
  if (!m.list.length) {
    return head + `<section class="panel dashed empty" style="min-height:240px">${icon.upload()}
      <h2 class="h2">${esc(t('mods.empty'))}</h2><p class="note">${esc(t('mods.emptySub'))}</p></section>`;
  }
  return head + `<section class="panel list" id="mods-list">
    ${list.map((x) => `<div class="list-row mod-row ${x.enabled ? '' : 'off'}" data-name="${esc(x.name)}" data-file="${esc(x.file)}" ${modMatches(x) ? '' : 'hidden'}>
      <span class="thumb mod-icon" aria-hidden="true">${esc((x.name || '?').charAt(0).toUpperCase())}</span>
      <div class="stack grow" style="gap:2px">
        <span class="row" style="gap:8px"><span class="card-title" style="font-size:calc(14px*var(--fs,1))">${esc(x.name)}</span>${x.version ? `<span class="badge">${esc(x.version)}</span>` : ''}</span>
        ${x.description ? `<span class="small muted ellipsis" style="max-width:560px">${esc(x.description.split('\n')[0])}</span>` : ''}
        <span class="small muted ellipsis" style="opacity:.75">${esc(x.file)}${x.authors ? ' · ' + esc(t('mods.by', { who: x.authors })) : ''}</span>
      </div>
      <button class="switch-row" style="width:auto;min-height:44px" role="switch" aria-checked="${x.enabled}" aria-label="${esc(t('mods.toggle', { name: x.name }))}" data-action="toggleMod" data-file="${esc(x.file)}"><span class="switch"></span></button>
      <button class="icon-btn" data-action="deleteMod" data-file="${esc(x.file)}" aria-label="${esc(t('mods.delete', { name: x.name }))}" title="${esc(t('mods.delete', { name: x.name }))}">${icon.trash()}</button>
    </div>`).join('')}
  </section>`;
}

function instWorlds(e) {
  const w = state.worlds;
  if (w.id !== e.id || w.list === null) {
    loadWorlds(e.id);
    return `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  }
  const b = state.backups;
  if (b.id !== e.id || b.list === null) loadBackups(e.id);
  const date = (secs) => new Date(secs * 1000).toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const mb = (n) => t('unit.mb', { n: (n / 1048576).toFixed(1) });

  const auto = `<section class="panel pad stack" style="gap:4px">
    ${switchRow('toggleAutoBackup', 'backupWorlds', e.backupWorlds, t('bk.auto'), t('bk.autoSub', { n: state.settings.backupKeep || 5 }))}
  </section>`;

  const dpBlock = (folder) => {
    if (state.dp.world !== folder) return '';
    const list = state.dp.list;
    const body = list === null
      ? `<div class="row"><span class="spinner"></span><span class="muted small">${esc(t('common.loading'))}</span></div>`
      : list.length
        ? list.map((d) => `<div class="row between"><span class="small">${esc(d.file)} <span class="muted">· ${esc(mb(d.size))}</span></span>
            <button class="btn sm" data-action="deleteDatapack" data-file="${esc(d.file)}">${icon.trash()}<span>${esc(t('common.delete'))}</span></button></div>`).join('')
        : `<span class="small muted">${esc(t('dp.none'))}</span>`;
    return `<div class="datapacks">${body}
      <div class="row"><button class="btn sm soft" data-action="findDatapacks">${esc(t('dp.find'))}</button></div></div>`;
  };

  const worlds = w.list.length
    ? `<section class="panel list">${w.list.map((x) => `
      <div class="list-row">
        ${x.icon && inApp ? `<img class="thumb" src="${esc(fileUrl(x.icon))}" alt="" style="image-rendering:pixelated">` : `<span class="thumb mod-icon" aria-hidden="true">${esc(x.folder.charAt(0).toUpperCase())}</span>`}
        <div class="stack grow" style="gap:2px">
          <span class="card-title" style="font-size:calc(15px*var(--fs,1))">${esc(x.folder)}</span>
          <span class="small muted">${esc(t('worlds.played', { date: date(x.lastPlayed) }))} · ${esc(mb(x.size))}</span>
        </div>
        <button class="btn sm" data-action="toggleDatapacks" data-folder="${esc(x.folder)}" aria-expanded="${state.dp.world === x.folder}">${esc(t('dp.title'))}</button>
        <button class="btn sm" data-action="makeBackup" data-folder="${esc(x.folder)}" ${state.backups.busy === x.folder ? 'disabled' : ''}>${state.backups.busy === x.folder ? '<span class="spinner"></span>' : icon.archive()}<span>${esc(t('bk.make'))}</span></button>
        <button class="icon-btn" data-action="copyWorld" data-folder="${esc(x.folder)}" aria-label="${esc(t('worlds.copy'))}" title="${esc(t('worlds.copy'))}">${icon.copy()}</button>
        <button class="icon-btn" data-action="openWorld" data-folder="${esc(x.folder)}" aria-label="${esc(t('worlds.open'))}" title="${esc(t('worlds.open'))}">${icon.folder()}</button>
        <button class="icon-btn" data-action="askDeleteWorld" data-folder="${esc(x.folder)}" aria-label="${esc(t('worlds.delete'))}" title="${esc(t('worlds.delete'))}">${icon.trash()}</button>
        ${dpBlock(x.folder)}
      </div>`).join('')}</section>`
    : `<section class="panel empty">${icon.box()}<h2 class="h2">${esc(t('worlds.empty'))}</h2><p class="note">${esc(t('worlds.emptySub'))}</p></section>`;

  const backups = b.list && b.list.length ? `<h2 class="h2" style="margin:6px 0 0 4px">${esc(t('bk.title'))}</h2>
    <section class="panel list">${b.list.map((x) => `
      <div class="list-row">
        <span class="thumb mod-icon" aria-hidden="true">${icon.archive(20)}</span>
        <div class="stack grow" style="gap:2px">
          <span class="card-title" style="font-size:calc(14px*var(--fs,1))">${esc(x.world)}</span>
          <span class="small muted">${esc(date(x.time))} · ${esc(mb(x.size))}</span>
        </div>
        <button class="btn sm" data-action="askRestore" data-file="${esc(x.file)}">${icon.restore()}<span>${esc(t('bk.restore'))}</span></button>
        <button class="icon-btn" data-action="deleteBackup" data-file="${esc(x.file)}" aria-label="${esc(t('bk.delete'))}" title="${esc(t('bk.delete'))}">${icon.trash()}</button>
      </div>`).join('')}</section>` : '';

  return auto + worlds + backups;
}

async function loadBackups(id) {
  if (state.backups.loading) return;
  state.backups = { id, list: null, loading: true };
  try { state.backups.list = await api.listBackups(id); } catch { state.backups.list = []; }
  state.backups.loading = false;
  if (state.view === 'instance' && state.instTab === 'worlds') render();
}

async function loadDatapacks(world) {
  state.dp = { world, list: null };
  render();
  try { state.dp.list = await api.listDatapacks(state.edit.id, world); } catch { state.dp.list = []; }
  if (state.dp.world === world) render();
}

function instShots(e) {
  const sh = state.shots;
  if (sh.id !== e.id || sh.list === null) {
    loadShots(e.id);
    return `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  }
  if (!sh.list.length) {
    return `<section class="panel empty">${icon.box()}<h2 class="h2">${esc(t('shots.empty'))}</h2><p class="note">${esc(t('shots.emptySub'))}</p></section>`;
  }
  return `<div class="shots">${sh.list.map((x) => `
    <figure class="shot">
      <button class="shot-img" data-action="openShot" data-file="${esc(x.file)}" aria-label="${esc(x.file)}"><img src="${esc(fileUrl(x.path))}" alt="" loading="lazy"></button>
      <figcaption class="row between">
        <span class="small muted ellipsis">${esc(new Date(x.time * 1000).toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
        <span class="row" style="gap:4px">
          <button class="btn sm" data-action="shotCover" data-file="${esc(x.file)}">${esc(t('shots.cover'))}</button>
          <button class="icon-btn" style="width:34px;height:34px" data-action="deleteShot" data-file="${esc(x.file)}" aria-label="${esc(t('shots.delete'))}">${icon.trash()}</button>
        </span>
      </figcaption>
    </figure>`).join('')}</div>`;
}

async function loadWorlds(id) {
  if (state.worlds.loading) return;
  state.worlds = { id, list: null, loading: true };
  try { state.worlds.list = await api.listWorlds(id); } catch (e) { state.worlds.list = []; toast(t('error.generic', { message: e }), true); }
  state.worlds.loading = false;
  if (state.view === 'instance') render();
}

async function loadShots(id) {
  if (state.shots.loading) return;
  state.shots = { id, list: null, loading: true };
  try { state.shots.list = await api.listScreenshots(id); } catch (e) { state.shots.list = []; toast(t('error.generic', { message: e }), true); }
  state.shots.loading = false;
  if (state.view === 'instance') render();
}

function instLaunch(e) {
  const input = (id, key, type = 'text', placeholder = '', extra = '') =>
    `<input id="${id}" class="input" type="${type}" placeholder="${esc(placeholder)}" value="${esc(e[key])}" data-bind="edit.${key}" ${extra}>`;
  return `
    <section class="panel pad stack" style="gap:12px">
      <div class="row between" style="align-items:baseline">
        <h2 class="h2">${esc(t('is.memory'))}</h2>
        <span id="mem-label" style="font-size:calc(22px*var(--fs,1));font-weight:700;color:var(--accent-text)">${e.memoryGb} ${esc(t('unit.gb'))}</span>
      </div>
      <label for="mem" class="label">${esc(t('is.memoryLabel'))}</label>
      <input id="mem" type="range" min="1" max="16" step="1" value="${e.memoryGb}" data-bind="edit.memoryGb" data-number>
      <div class="row between small muted"><span>1 ${esc(t('unit.gb'))}</span><span>8 ${esc(t('unit.gb'))}</span><span>16 ${esc(t('unit.gb'))}</span></div>
      <p class="note">${esc(t('is.memoryNote'))}</p>
    </section>

    <div class="grid grid-2">
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('is.java'))}</h2>
        <label for="java" class="label">${esc(t('is.javaLabel'))}</label>
        ${input('java', 'javaPath', 'text', 'C:\\Program Files\\Java\\…\\bin\\javaw.exe', 'class="input mono"')}
        <p class="note">${esc(t('is.javaAuto'))}</p>
      </section>
      <section class="panel pad stack" style="gap:12px">
        <h2 class="h2">${esc(t('is.window'))}</h2>
        <div class="row">
          <label for="ww" class="sr">${esc(t('is.width'))}</label>
          <input id="ww" class="input" style="width:110px" type="number" min="320" value="${e.windowWidth}" data-bind="edit.windowWidth" data-number>
          <span class="muted">×</span>
          <label for="wh" class="sr">${esc(t('is.height'))}</label>
          <input id="wh" class="input" style="width:110px" type="number" min="240" value="${e.windowHeight}" data-bind="edit.windowHeight" data-number>
        </div>
        ${switchRow('toggleEdit', 'fullscreen', e.fullscreen, t('is.fullscreen'))}
      </section>
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('is.server'))}</h2>
        <label for="srv" class="label">${esc(t('is.serverLabel'))}</label>
        ${input('srv', 'autoJoinServer', 'text', 'play.example.net')}
      </section>
    </div>

    <section class="panel" style="padding:4px 20px">
      <button class="switch-row" style="min-height:56px" data-action="toggleAdv" aria-expanded="${state.advOpen}">
        <span class="stack" style="gap:2px">
          <span class="h2">${esc(t('is.advanced'))}</span>
          <span class="note">${esc(t('is.advancedSub'))}</span>
        </span>
        <span style="transition:transform .2s;transform:rotate(${state.advOpen ? 180 : 0}deg)">${icon.chevronDown()}</span>
      </button>
      ${state.advOpen ? `<div class="stack" style="gap:14px;padding:16px 0 20px;border-top:1px solid var(--border)">
        <p class="note">${esc(t('is.advancedNote'))}</p>
        <label for="jvm" class="label strong">${esc(t('is.jvm'))}</label>
        <textarea id="jvm" class="input mono" rows="2" placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=50" data-bind="edit.jvmArgs">${esc(e.jvmArgs)}</textarea>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
          <div class="field"><label for="pre" class="label strong">${esc(t('is.pre'))}</label>${input('pre', 'preLaunchCommand', 'text', t('is.prePlaceholder'))}</div>
          <div class="field"><label for="post" class="label strong">${esc(t('is.post'))}</label>${input('post', 'postExitCommand', 'text', t('common.optional'))}</div>
          <div class="field"><label for="wrap" class="label strong">${esc(t('is.wrapper'))}</label>${input('wrap', 'wrapperCommand', 'text', t('common.optional'))}</div>
          <div class="field"><label for="env" class="label strong">${esc(t('is.env'))}</label>${input('env', 'envVars', 'text', 'KEY=value')}</div>
        </div>
        ${switchRow('toggleEdit', 'showConsole', e.showConsole, t('is.console'))}
      </div>` : ''}
    </section>`;
}

function modMatches(x) {
  const q = state.mods.query.trim();
  if (!q) return true;
  return matchScore(q, x.name, x.file.replace(/\.jar(\.disabled)?$/i, '')) > 0;
}

/** Фильтр модов: просто прячем лишние строки, поле поиска не трогаем. */
function filterModRows() {
  document.querySelectorAll('#mods-list .mod-row').forEach((row) => {
    row.hidden = !modMatches({ name: row.dataset.name, file: row.dataset.file });
  });
}

async function loadMods(id) {
  state.mods = { ...state.mods, id, loading: true, list: state.mods.id === id ? state.mods.list : null };
  try {
    state.mods.list = await api.listMods(id);
  } catch (err) {
    state.mods.list = [];
    toast(t('error.generic', { message: err }), true);
  }
  state.mods.loading = false;
  if (state.view === 'instance') render();
}

function installButton(m) {
  const r = state.res;
  if (r.installing[m.id]) return `<button class="btn sm soft" disabled><span class="spinner"></span>${esc(t('res.installing'))}</button>`;
  if (r.kind !== 'modpack' && r.installed.has(m.id)) return `<button class="btn sm" disabled>${esc(t('res.installed'))}</button>`;
  return `<button class="btn sm soft" data-action="install" data-pid="${esc(m.id)}" data-title="${esc(m.title)}">${esc(t('res.install'))}</button>`;
}

async function loadInstalled(id) {
  if (!id) return;
  state.res.installedFor = id;
  try { state.res.installed = new Set(await api.installedProjects(id)); } catch { state.res.installed = new Set(); }
  refreshResults();
}

/** Только список результатов (без поля поиска), чтобы при вводе не сбивался курсор. */
function resultsHtml() {
  const r = state.res;
  const target = state.instances.find((i) => i.id === r.targetId) || selected();
  if (target && r.installedFor !== target.id) loadInstalled(target.id);
  let results = '';
  if (r.source === 'curseforge') {
    results = `<section class="panel empty">${icon.warn(32)}
      <h2 class="h2">${esc(t('res.cfTitle'))}</h2>
      <p class="note" style="max-width:520px">${esc(t('res.cfText'))}</p>
      <button class="btn" data-action="nav" data-view="settings">${esc(t('res.cfGoSettings'))}</button></section>`;
  } else if (r.loading && !r.results) {
    results = `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  } else if (r.error) {
    results = `<section class="panel empty"><span class="warn">${esc(t('res.error', { source: 'Modrinth' }))}</span>
      <button class="btn sm" data-action="search">${esc(t('create.retry'))}</button></section>`;
  } else if (r.results && !r.results.length) {
    results = `<section class="panel empty"><span class="muted">${esc(t('res.nothing'))}</span></section>`;
  } else if (r.results) {
    results = `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      ${r.results.map((m) => `<article class="panel result">
        ${m.icon ? `<img class="thumb" src="${esc(m.icon)}" alt="" loading="lazy">` : `<span class="thumb" style="background:${TINTS[5]}"></span>`}
        <div class="stack grow" style="gap:6px">
          <div class="row" style="gap:8px">
            <h2 class="h2" style="font-size:calc(15px*var(--fs,1))">${esc(m.title)}</h2>
            <span class="badge">Modrinth</span>
          </div>
          <span class="small muted">${esc(t('res.by', { author: m.author }))} · ${esc(t('res.downloads', { n: formatNumber(m.downloads) }))}</span>
          <p class="note" style="line-height:1.45">${esc(m.description)}</p>
          <a href="#" class="small" data-action="openUrl" data-url="${esc(m.url)}">modrinth.com</a>
        </div>
        ${installButton(m)}
      </article>`).join('')}
    </div>`;
  }
  return results;
}

function viewResources() {
  const r = state.res;
  const target = state.instances.find((i) => i.id === r.targetId) || selected();

  return `<div class="view">
    <h1 class="page-title">${esc(t('res.title'))}</h1>
    <section class="panel pad-s stack" style="gap:12px">
      <div class="row">
        <label for="q" class="sr">${esc(t('res.searchLabel'))}</label>
        <input id="q" class="input" style="flex:1 1 280px" type="search" placeholder="${esc(t('res.search'))}" value="${esc(r.query)}" data-bind="res.query" data-search>
        <label for="target" class="sr">${esc(t('res.target'))}</label>
        <select id="target" class="input" style="flex:0 1 280px" data-change="setTarget" ${state.instances.length ? '' : 'disabled'}>
          ${state.instances.length
            ? state.instances.map((i) => `<option value="${esc(i.id)}" ${i.id === target?.id ? 'selected' : ''}>${esc(t('res.target'))}: ${esc(i.name)}</option>`).join('')
            : `<option>${esc(t('res.noTarget'))}</option>`}
        </select>
      </div>
      <div class="row between">
        <div class="row" style="gap:6px" role="group" aria-label="${esc(t('res.kind'))}">
          ${RES_KINDS.map((k) => `<button class="pill" data-action="setKind" data-kind="${k}" ${pressed(k === r.kind)}>${esc(t('res.kind.' + k))}</button>`).join('')}
        </div>
        <div class="seg" role="group" aria-label="${esc(t('res.source'))}">
          <button data-action="setSource" data-source="modrinth" ${pressed(r.source === 'modrinth')}>Modrinth</button>
          <button data-action="setSource" data-source="curseforge" ${pressed(r.source === 'curseforge')}>CurseForge</button>
        </div>
      </div>
      ${target ? `<span class="small muted">${esc(t('res.filterNote', { version: target.gameVersion, loader: loaderLabel(target.loader) }))}</span>` : ''}
    </section>
    <div id="res-results">${resultsHtml()}</div>
  </div>`;
}

async function loadAccountSkin(acc) {
  const sk = state.skins;
  sk.accountFor = acc.id;
  sk.account = 'loading';
  try { sk.account = await api.accountSkin(acc.id); } catch { sk.account = { image: '', slim: false, capes: [], editable: false, error: true }; }
  if (state.view === 'skins') render();
}

async function loadSkinLibrary() {
  state.skins.library = 'loading';
  try { state.skins.library = await api.listSkins(); } catch { state.skins.library = []; }
  if (state.view === 'skins') render();
}

function skinStage(image, slim, cape) {
  return `<div class="skin-stage">
    ${['front', 'back', 'side'].map((side) => `<figure>${skinCanvas({ image, slim, side, cape, size: 220, label: t('skins.view.' + side) })}
      <figcaption>${esc(t('skins.view.' + side))}</figcaption></figure>`).join('')}
  </div>`;
}

function viewSkins() {
  const sk = state.skins;
  const acc = activeAccount();
  if (acc && sk.accountFor !== acc.id) loadAccountSkin(acc);
  if (sk.library === null) loadSkinLibrary();
  const lib = Array.isArray(sk.library) ? sk.library : [];
  const picked = lib.find((k) => k.file === sk.pick) || null;
  const cur = sk.account && sk.account !== 'loading' ? sk.account : null;
  const activeCape = cur?.capes?.find((c) => c.active)?.image || '';
  const isMs = acc?.kind === 'microsoft';

  // Что показываем на большой сцене: выбранный в коллекции скин или текущий скин аккаунта
  let stage;
  if (picked) {
    stage = `<div class="row between"><div class="stack" style="gap:2px"><span class="small muted">${esc(t('skins.previewing'))}</span><h2 class="h2-lg">${esc(picked.name)}</h2></div>
        <button class="btn sm" data-action="skinUnpick">${esc(t('skins.backToCurrent'))}</button></div>
      ${skinStage(picked.image, picked.slim, activeCape)}
      <div class="row" style="justify-content:center">
        <div class="seg" role="group" aria-label="${esc(t('skins.model'))}">
          <button data-action="skinSetSlim" data-slim="0" ${pressed(!picked.slim)}>${esc(t('skins.classic'))}</button>
          <button data-action="skinSetSlim" data-slim="1" ${pressed(picked.slim)}>${esc(t('skins.slim'))}</button>
        </div>
        ${isMs ? `<button class="btn accent" data-action="applySkin" ${sk.busy ? 'disabled' : ''}>${sk.busy ? '<span class="spinner"></span>' : ''}${esc(t('skins.apply'))}</button>` : ''}
        <button class="btn" data-action="renameSkin">${icon.edit()}<span>${esc(t('ctx.rename'))}</span></button>
        <button class="btn" data-action="deleteSkin">${icon.trash()}<span>${esc(t('common.delete'))}</span></button>
      </div>
      ${acc && !isMs ? `<p class="note" style="text-align:center">${esc(t('skins.elyApplyNote'))}</p>` : ''}`;
  } else if (!acc) {
    stage = `<div class="empty" style="padding:24px">${skinCanvas({ image: '', size: 200 })}<h2 class="h2">${esc(t('skins.noAccount'))}</h2>
      <button class="btn accent" data-action="nav" data-view="accounts">${esc(t('launch.goAccounts'))}</button></div>`;
  } else if (!cur) {
    stage = `<div class="row" style="padding:40px;justify-content:center"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  } else {
    stage = `<div class="row between"><div class="stack" style="gap:2px"><span class="small muted">${esc(t('skins.current'))}</span><h2 class="h2-lg">${esc(acc.name)}</h2></div>
        <span class="badge">${esc(cur.slim ? t('skins.slim') : t('skins.classic'))}</span></div>
      ${cur.error ? `<p class="warn">${esc(t('skins.loadError'))}</p>` : ''}
      ${skinStage(cur.image, cur.slim, activeCape)}
      <div class="row" style="justify-content:center">
        ${cur.image ? `<button class="btn" data-action="saveCurrentSkin">${icon.copy()}<span>${esc(t('skins.saveCurrent'))}</span></button>` : ''}
        ${!isMs ? `<button class="btn soft" data-action="openUrl" data-url="https://ely.by/skins">${esc(t('skins.changeOnEly'))}</button>` : ''}
      </div>`;
  }

  const capes = isMs && cur?.capes?.length ? `<section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('skins.capes'))}</h2>
      <div class="row" style="gap:8px">
        <button class="card cape-btn" data-action="setCape" data-cape="" ${pressed(!cur.capes.some((c) => c.active))}><span style="height:48px;display:flex;align-items:center" class="small muted">${esc(t('skins.noCape'))}</span></button>
        ${cur.capes.map((c) => `<button class="card cape-btn" data-action="setCape" data-cape="${esc(c.id)}" ${pressed(c.active)} title="${esc(c.alias)}">
          <canvas class="cape-canvas" width="10" height="16" data-cape="${esc(c.image)}" style="width:30px;height:48px"></canvas>
          <span class="small ellipsis" style="max-width:56px">${esc(c.alias)}</span></button>`).join('')}
      </div></section>` : '';

  const library = `<section class="panel pad stack" style="gap:12px">
      <div class="row between">
        <h2 class="h2">${esc(t('skins.mine'))}</h2>
        <button class="btn sm soft" data-action="importSkin">${icon.upload(16)}<span>${esc(t('skins.add'))}</span></button>
      </div>
      ${sk.library === 'loading' || sk.library === null ? `<div class="row"><span class="spinner"></span></div>`
        : lib.length ? `<div class="skin-grid">${lib.map((k) => `<button class="card skin-card" data-action="skinPick" data-file="${esc(k.file)}" ${pressed(k.file === sk.pick)}>
            ${skinCanvas({ image: k.image, slim: k.slim, size: 96, label: k.name })}
            <span class="name ellipsis">${esc(k.name)}</span></button>`).join('')}</div>`
        : `<p class="note">${esc(t('skins.libraryEmpty'))}</p>`}
    </section>`;

  return `<div class="view">
    <h1 class="page-title">${esc(t('skins.title'))}</h1>
    <section class="panel pad stack" style="gap:14px">${stage}</section>
    ${capes}
    ${library}
  </div>`;
}

function viewAccounts() {
  const list = state.accounts.length
    ? `<section class="panel list">${state.accounts.map((a) => `
        <div class="list-row">
          <span class="avatar" style="${a.kind === 'ely' ? 'background:#207E5C' : ''}">${esc(a.name.charAt(0).toUpperCase())}</span>
          <div class="stack grow" style="gap:2px">
            <span class="card-title">${esc(a.name)}</span>
            <span class="small muted">${esc(t('acc.kind.' + a.kind))}</span>
          </div>
          ${a.active
            ? `<span class="badge" style="background:var(--accent-soft);color:var(--accent-text);padding:6px 12px">${esc(t('acc.active'))}</span>`
            : `<button class="btn sm" data-action="setActiveAccount" data-id="${esc(a.id)}">${esc(t('acc.makeActive'))}</button>`}
          <button class="icon-btn" data-action="removeAccount" data-id="${esc(a.id)}" aria-label="${esc(t('acc.remove'))}" title="${esc(t('acc.remove'))}">${icon.trash()}</button>
        </div>`).join('')}</section>`
    : `<section class="panel empty"><h2 class="h2">${esc(t('acc.none'))}</h2><p class="note">${esc(t('acc.noneSub'))}</p></section>`;

  return `<div class="view">
    <h1 class="page-title">${esc(t('acc.title'))}</h1>
    ${list}
    <h2 class="h2" style="margin:8px 0 0 4px">${esc(t('acc.add'))}</h2>
    <div class="grid grid-2">
      <section class="panel pad stack">
        <span class="avatar" style="width:28px;height:28px;border-radius:6px;font-size:calc(14px*var(--fs,1));background:#207E5C">E</span>
        <h3 class="h2">${esc(t('acc.ely'))}</h3>
        <p class="note">${esc(t('acc.elyText'))}</p>
        <button class="btn accent" style="align-self:flex-start" data-action="openEly">${esc(t('acc.elyBtn'))}</button>
      </section>
      <section class="panel pad stack">
        ${icon.microsoft()}
        <h3 class="h2">${esc(t('acc.ms'))}</h3>
        <p class="note">${esc(t(state.msBusy ? 'acc.msWaiting' : 'acc.msText'))}</p>
        ${state.msReady
          ? `<button class="btn accent" style="align-self:flex-start" data-action="msLogin" ${state.msBusy ? 'disabled' : ''}>${state.msBusy ? '<span class="spinner"></span>' : ''}${esc(t('acc.msBtn'))}</button>`
          : `<span class="badge" style="align-self:flex-start;padding:6px 12px">${esc(t('acc.msPending'))}</span>
             <p class="small muted">${esc(t('acc.msPendingSub'))}</p>`}
      </section>
    </div>
  </div>`;
}

const ACCENTS = ['#FF8CC6', '#B78CFF', '#8B9CFF', '#4FD8E8', '#4ADE9A', '#FFD166', '#FF9A3C', '#FF6B78'];

/** Ползунок, который сразу показывает значение. scale — во сколько раз число в настройках меньше числа на ползунке. */
function rangeRow({ id, key, label, min, max, step, value, unit = '', scale = 1, live = true }) {
  return `<div class="range-row">
    <label for="${id}" class="label">${esc(label)}</label><output id="${id}-out">${Math.round(value * scale)}${esc(unit)}</output>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${Math.round(value * scale)}" style="grid-column:1 / -1"
      data-bind="settings.${key}" data-number data-scale="${scale}" data-unit="${esc(unit)}" ${live ? 'data-live' : ''} data-save-settings>
  </div>`;
}

function setLook(s) {
  const card = (id, T, name, extra = '') => `<button class="card theme-card" data-action="setTheme" data-theme="${esc(id)}" ${pressed(id === s.theme)} ${extra}>
      <span class="theme-preview" style="border:1px solid ${T.border};background:radial-gradient(120px 60px at 90% 0%,${T.g1},transparent 70%),${T.bg}">
        <span class="side" style="background:${T.surface};border-right:1px solid ${T.border}"></span>
        <span class="main"><span class="hero-mini" style="background:${T.surface2}"></span><span class="btn-mini" style="background:${T.accent}"></span></span>
      </span>
      <span style="font-weight:600" class="ellipsis">${esc(name)}</span>
    </button>`;
  const custom = s.customThemes || [];
  const themeName = s.theme.startsWith('custom:') ? custom.find((c) => 'custom:' + c.id === s.theme)?.name : t('theme.' + s.theme);
  const bg = s.background || {};
  const bgUrl = bg.path ? (inApp ? fileUrl(bg.path) : bg.path) : '';
  return `
    <section class="panel pad stack" style="gap:14px">
      <div class="row between">
        <div class="stack" style="gap:2px">
          <h2 class="h2">${esc(t('set.theme'))}</h2>
          <span class="note">${esc(t('set.themeNow', { name: themeName || '' }))}</span>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn sm" data-action="importTheme">${icon.upload(16)}<span>${esc(t('te.import'))}</span></button>
          <button class="btn sm soft" data-action="newTheme">${icon.sparkle()}<span>${esc(t('te.create'))}</span></button>
        </div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))" role="group" aria-label="${esc(t('set.theme'))}">
        ${THEME_ORDER.map((id) => card(id, THEMES[id], t('theme.' + id))).join('')}
        ${custom.map((c) => card('custom:' + c.id, themeFromColors(c), c.name)).join('')}
      </div>
      ${s.theme.startsWith('custom:') ? `<div class="row"><button class="btn sm" data-action="editTheme">${icon.edit()}<span>${esc(t('te.edit'))}</span></button></div>` : ''}
      ${resolveTheme(s).deco ? switchRow('toggleSetting', 'showDecorations', s.showDecorations !== false, t('set.decorations'), t('set.decorationsSub')) : ''}
      <input type="file" id="theme-file" accept=".json,application/json" hidden>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <div class="stack" style="gap:2px"><h2 class="h2">${esc(t('look.accent'))}</h2><span class="note">${esc(t('look.accentSub'))}</span></div>
      <div class="row" style="gap:14px">
        <div class="swatches" role="group" aria-label="${esc(t('look.accent'))}">
          <button class="swatch none" data-action="setAccent" data-color="" ${pressed(!s.accent)} title="${esc(t('look.accentTheme'))}" aria-label="${esc(t('look.accentTheme'))}"></button>
          ${ACCENTS.map((c) => `<button class="swatch" style="background:${c}" data-action="setAccent" data-color="${c}" ${pressed(s.accent === c)} aria-label="${c}"></button>`).join('')}
        </div>
        <label class="color-row small muted"><input type="color" value="${esc(s.accent || resolveTheme(s).accent)}" data-accent-picker>${esc(t('look.accentOwn'))}</label>
      </div>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <div class="row between">
        <div class="stack" style="gap:2px"><h2 class="h2">${esc(t('look.bg'))}</h2><span class="note">${esc(t('look.bgSub'))}</span></div>
        <div class="row" style="gap:8px">
          <button class="btn sm soft" data-action="pickBackground">${icon.image(16)}<span>${esc(t('look.bgPick'))}</span></button>
          ${bg.path ? `<button class="btn sm" data-action="clearBackground">${esc(t('cover.remove'))}</button>` : ''}
        </div>
      </div>
      ${bgUrl ? `<div class="bg-preview" style="background-image:url('${esc(bgUrl)}')"></div>
        <div class="grid grid-2">
          ${rangeRow({ id: 'bgdim', key: 'background.dim', label: t('look.bgDim'), min: 0, max: 90, step: 5, value: bg.dim ?? 65, unit: '%' })}
          ${rangeRow({ id: 'bgblur', key: 'background.blur', label: t('look.bgBlur'), min: 0, max: 30, step: 1, value: bg.blur ?? 8, unit: ' px' })}
        </div>` : ''}
    </section>

    <section class="panel pad stack" style="gap:14px">
      <h2 class="h2">${esc(t('look.sizes'))}</h2>
      <div class="grid grid-2">
        ${rangeRow({ id: 'uiscale', key: 'uiScale', label: t('look.scale'), min: 80, max: 130, step: 5, value: s.uiScale || 1, unit: '%', scale: 100, live: false })}
        ${rangeRow({ id: 'textscale', key: 'textScale', label: t('look.text'), min: 90, max: 125, step: 5, value: s.textScale || 1, unit: '%', scale: 100 })}
        ${rangeRow({ id: 'radius', key: 'radiusScale', label: t('look.radius'), min: 30, max: 160, step: 10, value: s.radiusScale ?? 1, unit: '%', scale: 100 })}
        <div class="stack" style="gap:8px">
          <span class="label">${esc(t('look.density'))}</span>
          <div class="seg" role="group" aria-label="${esc(t('look.density'))}" style="align-self:flex-start">
            ${['compact', 'normal', 'roomy'].map((d) => `<button data-action="setDensity" data-d="${d}" ${pressed((s.density || 'normal') === d)}>${esc(t('look.density.' + d))}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="row"><button class="btn sm" data-action="resetLook">${esc(t('look.reset'))}</button></div>
      ${switchRow('toggleSetting', 'reduceMotion', s.reduceMotion, t('set.reduceMotion'), t('set.reduceMotionSub'))}
    </section>`;
}

function setSound(s) {
  return `
    <section class="panel pad stack" style="gap:8px">
      <h2 class="h2">${esc(t('snd.title'))}</h2>
      ${switchRow('toggleOn', 'sound', s.sound !== false, t('snd.sound'), t('snd.soundSub'))}
      ${s.sound !== false ? `<div class="row" style="gap:14px;align-items:flex-end">
        <div style="flex:1 1 260px">${rangeRow({ id: 'vol', key: 'soundVolume', label: t('snd.volume'), min: 5, max: 100, step: 5, value: s.soundVolume ?? 60, unit: '%' })}</div>
        <button class="btn sm" data-action="testChime">${icon.bell(16)}<span>${esc(t('snd.test'))}</span></button>
      </div>` : ''}
      ${switchRow('toggleOn', 'notifications', s.notifications !== false, t('snd.notify'), t('snd.notifySub'))}
    </section>`;
}

function setGame(s) {
  return `
    <section class="panel pad stack" style="gap:6px">
      <h2 class="h2" style="margin-bottom:6px">${esc(t('set.behavior'))}</h2>
      ${switchRow('toggleSetting', 'hideOnLaunch', s.hideOnLaunch, t('set.hideOnLaunch'))}
      ${s.hideOnLaunch ? `<div class="stack" style="gap:8px;padding:6px 0 10px">
        <span class="label">${esc(t('set.afterClose'))}</span>
        <div class="seg" role="group" aria-label="${esc(t('set.afterClose'))}" style="align-self:flex-start">
          <button data-action="setAfterClose" data-v="restore" ${pressed(s.afterGameClose !== 'stay')}>${esc(t('set.afterClose.restore'))}</button>
          <button data-action="setAfterClose" data-v="stay" ${pressed(s.afterGameClose === 'stay')}>${esc(t('set.afterClose.stay'))}</button>
        </div></div>` : ''}
      ${switchRow('toggleSetting', 'autoJava', s.autoJava, t('set.autoJava'))}
    </section>

    <section class="panel pad stack" style="gap:14px">
      <div class="stack" style="gap:2px"><h2 class="h2">${esc(t('def.title'))}</h2><span class="note">${esc(t('def.sub'))}</span></div>
      ${rangeRow({ id: 'defmem', key: 'defaultMemoryGb', label: t('is.memory'), min: 1, max: 16, step: 1, value: s.defaultMemoryGb || 4, unit: ' ' + t('unit.gb'), live: false })}
      <div class="row">
        <span class="label" style="min-width:120px">${esc(t('is.window'))}</span>
        <label for="defw" class="sr">${esc(t('is.width'))}</label>
        <input id="defw" class="input" style="width:110px" type="number" min="320" value="${s.defaultWindowWidth || 1280}" data-bind="settings.defaultWindowWidth" data-number data-save-settings>
        <span class="muted">×</span>
        <label for="defh" class="sr">${esc(t('is.height'))}</label>
        <input id="defh" class="input" style="width:110px" type="number" min="240" value="${s.defaultWindowHeight || 720}" data-bind="settings.defaultWindowHeight" data-number data-save-settings>
      </div>
      ${switchRow('toggleSetting', 'defaultFullscreen', s.defaultFullscreen, t('is.fullscreen'))}
      ${switchRow('toggleSetting', 'defaultBackupWorlds', s.defaultBackupWorlds, t('bk.auto'))}
      <div class="field">
        <label for="defjvm" class="label">${esc(t('is.jvm'))}</label>
        <textarea id="defjvm" class="input mono" rows="2" placeholder="-XX:+UseG1GC" data-bind="settings.defaultJvmArgs" data-save-settings>${esc(s.defaultJvmArgs || '')}</textarea>
      </div>
    </section>

    <section class="panel pad stack" style="gap:10px">
      <h2 class="h2">${esc(t('bk.title'))}</h2>
      ${rangeRow({ id: 'bkkeep', key: 'backupKeep', label: t('bk.keep'), min: 1, max: 30, step: 1, value: s.backupKeep || 5, live: false })}
    </section>`;
}

function setGeneral(s) {
  return `<div class="grid grid-2">
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('set.general'))}</h2>
        <label for="lang" class="label">${esc(t('set.language'))}</label>
        <select id="lang" class="input" data-change="setLanguage">
          ${Object.entries(LANGS).map(([code, dict]) => `<option value="${code}" ${code === s.language ? 'selected' : ''}>${esc(dict['lang.name'])}</option>`).join('')}
        </select>
        ${switchRow('toggleSetting', 'checkUpdates', s.checkUpdates, t('set.checkUpdates'))}
      </section>
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('set.apis'))}</h2>
        <label for="cfkey" class="label">${esc(t('set.cfKey'))}</label>
        <input id="cfkey" class="input mono" type="password" autocomplete="off" value="${esc(s.curseforgeKey)}" data-bind="settings.curseforgeKey" data-save-settings>
        <p class="note">${esc(t('set.cfKeyNote'))}</p>
      </section>
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('set.about'))}</h2>
        <p class="note">${esc(t('set.aboutText', { version: APP_VERSION }))}</p>
        <p class="note">${esc(t('set.disclaimer'))}</p>
        <a href="#" data-action="openUrl" data-url="${REPO_URL}">${esc(t('set.sourceCode'))}</a>
      </section>
    </div>`;
}

function viewSettings() {
  const s = state.settings;
  const tab = state.setTab;
  const tabs = ['look', 'sound', 'game', 'general'].map((k) =>
    `<button role="tab" aria-selected="${tab === k}" data-action="setSetTab" data-tab="${k}">${esc(t('set.tab.' + k))}</button>`).join('');
  const body = { look: setLook, sound: setSound, game: setGame, general: setGeneral }[tab](s);
  return `<div class="view">
    <h1 class="page-title">${esc(t('set.title'))}</h1>
    <div class="tabs" role="tablist">${tabs}</div>
    ${body}
  </div>`;
}

const VIEWS = { home: viewHome, instances: viewInstances, create: viewCreate, instance: viewInstance, resources: viewResources, skins: viewSkins, accounts: viewAccounts, settings: viewSettings };

// ---------- Отрисовка ----------

function renderChrome() {
  $('#titlebar').innerHTML = `
    <div class="brand" data-tauri-drag-region>${icon.moon()}<span data-tauri-drag-region>Spectia</span></div>
    <div class="winbtns">
      <button class="winbtn" data-action="winMin" aria-label="${esc(t('win.minimize'))}">${icon.minimize()}</button>
      <button class="winbtn" data-action="winMax" aria-label="${esc(t('win.maximize'))}">${icon.maximize()}</button>
      <button class="winbtn close" data-action="winClose" aria-label="${esc(t('win.close'))}">${icon.close()}</button>
    </div>`;

  const active = NAV_OF_VIEW[state.view];
  $('#sidebar').setAttribute('aria-label', t('nav.label'));
  $('#sidebar').innerHTML = `
    <div class="nav">
      ${NAV.map((n) => `<button class="nav-item" data-action="nav" data-view="${n.view}" aria-current="${n.id === active ? 'page' : 'false'}"><span class="bar"></span><span>${esc(t('nav.' + n.id))}</span></button>`).join('')}
    </div>
    <div class="stack" style="gap:8px">
      <span class="small muted" style="padding:0 4px">${esc(t('nav.account'))}</span>
      <button class="account" data-action="nav" data-view="accounts" aria-label="${esc(t('nav.manageAccounts'))}">
        ${(() => {
          const a = activeAccount();
          return a
            ? `<span class="avatar" style="${a.kind === 'ely' ? 'background:#207E5C' : ''}">${esc(a.name.charAt(0).toUpperCase())}</span>
               <span class="stack grow" style="gap:2px;min-width:0"><span class="ellipsis" style="font-weight:600">${esc(a.name)}</span><span class="small muted">${esc(t('acc.kind.' + a.kind))}</span></span>`
            : `<span class="avatar">?</span>
               <span class="stack grow" style="gap:2px"><span style="font-weight:600">${esc(t('acc.notSigned'))}</span><span class="small muted">Microsoft · Ely.by</span></span>`;
        })()}
        ${icon.chevronRight()}
      </button>
    </div>`;
}

function elyDialog() {
  const e = state.ely;
  return `<div class="overlay" data-action="closeDialog"><form class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop data-submit="elySubmit">
    <div class="row" style="gap:12px">
      <span class="avatar" style="width:36px;height:36px;border-radius:8px;background:#207E5C">E</span>
      <h2 id="dlg-title">${esc(t('acc.elyDialogTitle'))}</h2>
    </div>
    ${e.need2fa ? `
      <p class="note">${esc(t('acc.totpNote'))}</p>
      <div class="field"><label for="ely-totp" class="label">${esc(t('acc.totp'))}</label>
        <input id="ely-totp" class="input mono" inputmode="numeric" autocomplete="off" maxlength="8" value="${esc(e.totp)}" data-bind="ely.totp" autofocus></div>`
    : `
      <div class="field"><label for="ely-login" class="label">${esc(t('acc.login'))}</label>
        <input id="ely-login" class="input" autocomplete="off" value="${esc(e.username)}" data-bind="ely.username" autofocus></div>
      <div class="field"><label for="ely-pass" class="label">${esc(t('acc.password'))}</label>
        <input id="ely-pass" class="input" type="password" autocomplete="off" value="${esc(e.password)}" data-bind="ely.password"></div>
      <p class="note">${esc(t('acc.passwordNote'))}</p>`}
    ${e.error ? `<p class="warn" role="alert">${esc(e.error)}</p>` : ''}
    <div class="row between">
      <a href="#" class="small" data-action="openUrl" data-url="https://account.ely.by/register">${esc(t('acc.register'))}</a>
      <div class="row">
        <button type="button" class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn accent" ${e.busy ? 'disabled' : ''}>${e.busy ? '<span class="spinner"></span>' : ''}${esc(t('acc.signIn'))}</button>
      </div>
    </div>
  </form></div>`;
}

/** Очень простая разметка для списка изменений: заголовки, пункты списка и **жирный**. */
function miniMarkdown(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '';
  let inList = false;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (!line || line === '---') continue;
    if (line.startsWith('#')) html += `<p class="h2" style="margin-top:4px">${inline(line.replace(/^#+\s*/, ''))}</p>`;
    else html += `<p>${inline(line)}</p>`;
  }
  return html + (inList ? '</ul>' : '');
}

function updateDialog() {
  const u = state.update;
  const busy = state.updating;
  const pct = busy && busy.total ? Math.round((busy.downloaded / busy.total) * 100) : 0;
  return `<div class="overlay" ${busy ? '' : 'data-action="closeDialog"'}><div class="dialog" style="max-width:560px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
    <div class="row" style="gap:14px;flex-wrap:nowrap;align-items:flex-start">
      <span class="avatar" style="background:var(--accent);color:var(--accent-ink)">${icon.moon(22)}</span>
      <div class="stack" style="gap:4px">
        <h2 id="dlg-title">${esc(t('upd.title', { version: u.version }))}</h2>
        <p class="note">${esc(t('upd.subtitle', { current: u.currentVersion }))}</p>
      </div>
    </div>
    <div class="notes">${miniMarkdown(u.notes)}</div>
    ${busy ? `<div class="stack" style="gap:8px"><span class="small muted">${esc(t('upd.installing'))} ${pct}%</span>
      <div class="bar"><span style="width:${pct}%"></span></div></div>` : `
    <div class="row" style="justify-content:flex-end">
      <button class="btn" data-action="closeDialog">${esc(t('upd.later'))}</button>
      <button class="btn accent" data-action="installUpdate">${esc(t('upd.install'))}</button>
    </div>`}
  </div></div>`;
}

function updatesDialog() {
  const d = state.dialog;
  return `<div class="overlay" ${d.busy ? '' : 'data-action="closeDialog"'}><div class="dialog" style="max-width:600px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
    <h2 id="dlg-title">${esc(t('mods.updTitle', { n: d.list.length }))}</h2>
    <p class="note">${esc(t('mods.updText'))}</p>
    <div class="list" style="padding:0;max-height:300px;overflow:auto">
      ${d.list.map((u, n) => `<label class="list-row" style="cursor:pointer;padding:10px 4px">
        <input type="checkbox" data-upd="${n}" ${d.picked.has(n) ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)">
        <span class="grow"><b>${esc(u.name)}</b> <span class="muted small">${esc(u.current)} → ${esc(u.latest)}</span></span>
      </label>`).join('')}
    </div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn" data-action="closeDialog" ${d.busy ? 'disabled' : ''}>${esc(t('common.cancel'))}</button>
      <button class="btn" data-action="duplicate" data-id="${esc(state.edit?.id || '')}" ${d.busy ? 'disabled' : ''}>${icon.copy()}<span>${esc(t('is.duplicate'))}</span></button>
      <button class="btn accent" data-action="applyUpdates" ${d.busy || !d.picked.size ? 'disabled' : ''}>${d.busy ? `<span class="spinner"></span>${esc(t('mods.updating'))}` : esc(t('mods.updApply'))}</button>
    </div>
  </div></div>`;
}

function contextMenu() {
  const { id, x, y } = state.ctx;
  const item = (action, ic, label, extra = '') =>
    `<button role="menuitem" data-action="${action}" data-id="${esc(id)}" ${extra}>${ic}<span>${esc(t(label))}</span></button>`;
  // Не даём меню вылезти за край окна
  const left = Math.min(x, window.innerWidth - 230);
  const top = Math.min(y, window.innerHeight - 450);
  const inst = state.instances.find((i) => i.id === id);
  return `<div class="ctx-backdrop" data-action="closeCtx"></div>
    <div class="ctx" role="menu" aria-label="${esc(t('ctx.label'))}" style="left:${left}px;top:${top}px">
      ${item('ctxPlay', icon.play(14), 'ctx.play')}
      ${item('ctxSettings', icon.gear(16), 'ctx.settings')}
      ${item('ctxFolder', icon.folder(16), 'ctx.folder')}
      <div class="ctx-sep" role="separator"></div>
      ${item('ctxRename', icon.edit(), 'ctx.rename')}
      ${item('ctxCover', icon.palette(), 'ctx.cover')}
      ${item('ctxDuplicate', icon.copy(), 'ctx.duplicate')}
      ${item('ctxShare', icon.upload(16), 'ctx.share')}
      <div class="ctx-sep" role="separator"></div>
      ${item('toggleFavorite', icon.star(16), inst?.favorite ? 'org.unfavorite' : 'org.favorite')}
      ${item('toggleArchive', icon.archive(), inst?.archived ? 'org.unarchive' : 'org.toArchive')}
      <div class="ctx-sep" role="separator"></div>
      ${item('ctxDelete', icon.trash(), 'ctx.delete', 'class="danger"')}
    </div>`;
}

function renderOverlay() {
  let html = '';
  const d = state.dialog;
  if (d?.type === 'confirmDelete') {
    const inst = state.instances.find((i) => i.id === d.id);
    html += `<div class="overlay" data-action="closeDialog">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
        <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:nowrap">
          <span class="avatar" style="background:var(--warn-soft);color:var(--warn-text)">${icon.warn()}</span>
          <div class="stack" style="gap:4px">
            <h2 id="dlg-title">${esc(t('inst.deleteConfirmTitle', { name: inst?.name ?? '' }))}</h2>
            <p class="note">${esc(t('inst.deleteConfirmText'))}</p>
          </div>
        </div>
        <div class="row" style="justify-content:flex-end">
          <button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
          <button class="btn accent" data-action="confirmDelete" data-id="${esc(d.id)}">${esc(t('common.delete'))}</button>
        </div>
      </div>
    </div>`;
  }
  if (d?.type === 'ely') html += elyDialog();
  if (d?.type === 'noAccount') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <h2 id="dlg-title">${esc(t('launch.noAccountTitle'))}</h2>
      <p class="note">${esc(t('launch.noAccountText'))}</p>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button class="btn accent" data-action="goAccounts">${esc(t('launch.goAccounts'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'crash') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:720px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:nowrap">
        <span class="avatar" style="background:var(--warn-soft);color:var(--warn-text)">${icon.warn()}</span>
        <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('launch.crashTitle'))}</h2><p class="note">${esc(t('launch.crashText'))}</p></div>
      </div>
      <pre class="log">${esc(d.log || '—')}</pre>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="openFolder" data-id="${esc(d.id)}">${icon.folder()}<span>${esc(t('inst.openFolder'))}</span></button>
        <button class="btn" data-action="copyLog">${esc(t('launch.copyLog'))}</button>
        <button class="btn accent" data-action="closeDialog">${esc(t('common.close'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'update' && state.update) html += updateDialog();
  if (d?.type === 'rename') {
    html += `<div class="overlay" data-action="closeDialog"><form class="dialog" style="max-width:440px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop data-submit="renameSubmit">
      <h2 id="dlg-title">${esc(t('rename.title'))}</h2>
      <label for="rename-input" class="sr">${esc(t('rename.title'))}</label>
      <input id="rename-input" class="input" maxlength="60" value="${esc(d.name)}" data-bind="dialog.name" autofocus>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn accent">${esc(t('common.save'))}</button>
      </div></form></div>`;
  }
  if (d?.type === 'cover') {
    const inst = state.instances.find((i) => i.id === d.id);
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:440px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <h2 id="dlg-title">${esc(t('cover.title'))}</h2>
      <div class="row" style="gap:12px;align-items:center">
        <span class="thumb" style="width:64px;height:64px;border-radius:12px;${coverBg(inst)}"></span>
        <div class="row" style="gap:6px" role="group" aria-label="${esc(t('cover.title'))}">${tintButtons(inst?.tint ?? 0, 'pickTint')}</div>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn sm" data-action="pickCover" data-id="${esc(d.id)}">${icon.upload(16)}<span>${esc(t('cover.custom'))}</span></button>
        ${inst?.coverImage ? `<button class="btn sm" data-action="clearCover" data-id="${esc(d.id)}">${esc(t('cover.remove'))}</button>` : ''}
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn accent" data-action="closeDialog">${esc(t('common.close'))}</button></div>
    </div></div>`;
  }
  if (d?.type === 'confirmChange') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:nowrap">
        <span class="avatar" style="background:var(--warn-soft);color:var(--warn-text)">${icon.warn()}</span>
        <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('is.changeTitle'))}</h2><p class="note">${esc(t('is.changeText'))}</p></div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button class="btn" data-action="changeJust">${esc(t('is.changeJust'))}</button>
        <button class="btn accent" data-action="changeCopy">${esc(t('is.changeCopy'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'updates') html += updatesDialog();
  if (d?.type === 'pickWorld') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:480px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('dp.whichWorld'))}</h2><p class="note">${esc(t('dp.whichWorldSub', { name: d.title }))}</p></div>
      <div class="list" style="padding:0;max-height:320px;overflow:auto">
        ${d.worlds.map((w) => `<button class="list-row" style="border:0;background:transparent;cursor:pointer;text-align:left;width:100%" data-action="installToWorld" data-world="${esc(w.folder)}" ${d.busy ? 'disabled' : ''}>
          <span class="thumb mod-icon" style="width:36px;height:36px" aria-hidden="true">${esc(w.folder.charAt(0).toUpperCase())}</span>
          <span class="grow card-title" style="font-size:calc(14px*var(--fs,1))">${esc(w.folder)}</span>
          ${d.busy === w.folder ? '<span class="spinner"></span>' : icon.chevronRight()}
        </button>`).join('')}
      </div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button></div>
    </div></div>`;
  }
  if (d?.type === 'prism') {
    const sizeOf = (n) => (n > 1073741824 ? t('unit.gbN', { n: (n / 1073741824).toFixed(1) }) : t('unit.mb', { n: Math.round(n / 1048576) }));
    let body;
    if (!d.list) body = `<div class="row" style="padding:12px"><span class="spinner"></span><span class="muted">${esc(t('prism.searching'))}</span></div>`;
    else if (!d.list.length) body = `<p class="note">${esc(t('prism.notFound'))}</p>`;
    else body = `<div class="row between"><span class="small muted">${esc(t('prism.found', { n: d.list.length, source: d.list[0].source }))}</span>
        <button class="btn sm" data-action="prismAll" ${d.busy ? 'disabled' : ''}>${esc(t(d.picked.size === d.list.length ? 'prism.none' : 'prism.all'))}</button></div>
      <div class="list" style="padding:0;max-height:340px;overflow:auto">
        ${d.list.map((x, n) => `<label class="check-row list-row">
          <input type="checkbox" data-prism="${n}" ${d.picked.has(n) ? 'checked' : ''} ${d.busy ? 'disabled' : ''}>
          <span class="stack grow" style="gap:2px"><b>${esc(x.name)}</b>
            <span class="small muted">Minecraft ${esc(x.gameVersion)} · ${esc(loaderLabel(x.loader))}${x.loaderVersion ? ' ' + esc(x.loaderVersion) : ''} · ${esc(sizeOf(x.size))}</span></span>
        </label>`).join('')}
      </div>`;
    const prog = d.progress;
    html += `<div class="overlay" ${d.busy ? '' : 'data-action="closeDialog"'}><div class="dialog" style="max-width:620px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="gap:14px;flex-wrap:nowrap;align-items:flex-start">
        <span class="avatar" style="background:var(--accent-soft);color:var(--accent-text)">${icon.move(20)}</span>
        <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('prism.title'))}</h2><p class="note">${esc(t('prism.sub'))}</p></div>
      </div>
      ${body}
      ${d.busy && prog ? `<div class="stack" style="gap:8px"><span class="small muted">${esc(t('prism.copying', { name: prog.name || '', done: Math.min(prog.done + 1, prog.total), total: prog.total }))}</span>
        <div class="bar"><span class="indeterminate"></span></div></div>` : ''}
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog" ${d.busy ? 'disabled' : ''}>${esc(t('common.cancel'))}</button>
        ${d.list?.length ? `<button class="btn accent" data-action="prismImport" ${d.busy || !d.picked.size ? 'disabled' : ''}>${d.busy ? '<span class="spinner"></span>' : ''}${esc(t('prism.go', { n: d.picked.size }))}</button>` : ''}
      </div>
    </div></div>`;
  }
  if (d?.type === 'restore') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:nowrap">
        <span class="avatar" style="background:var(--accent-soft);color:var(--accent-text)">${icon.restore(20)}</span>
        <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('bk.restoreTitle', { name: d.world }))}</h2><p class="note">${esc(t('bk.restoreText', { date: d.date }))}</p></div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog" ${d.busy ? 'disabled' : ''}>${esc(t('common.cancel'))}</button>
        <button class="btn accent" data-action="restoreBackup" data-file="${esc(d.file)}" ${d.busy ? 'disabled' : ''}>${d.busy ? '<span class="spinner"></span>' : ''}${esc(t('bk.restore'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'renameSkin') {
    html += `<div class="overlay" data-action="closeDialog"><form class="dialog" style="max-width:440px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop data-submit="renameSkinSubmit">
      <h2 id="dlg-title">${esc(t('rename.title'))}</h2>
      <label for="rename-input" class="sr">${esc(t('rename.title'))}</label>
      <input id="rename-input" class="input" maxlength="40" value="${esc(d.name)}" data-bind="dialog.name" autofocus>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button type="submit" class="btn accent">${esc(t('common.save'))}</button>
      </div></form></div>`;
  }
  if (d?.type === 'themeEditor') {
    const color = (key, label) => `<label class="color-row"><input type="color" value="${esc(d[key])}" data-bind="dialog.${key}" data-live-theme><span class="stack" style="gap:2px"><span>${esc(label)}</span><span class="small muted mono">${esc(d[key])}</span></span></label>`;
    html += `<div class="overlay side" data-action="closeDialog"><form class="dialog" style="max-width:380px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop data-submit="saveTheme">
      <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t(d.id ? 'te.editTitle' : 'te.createTitle'))}</h2><p class="note">${esc(t('te.sub'))}</p></div>
      <div class="field"><label for="te-name" class="label">${esc(t('te.name'))}</label>
        <input id="te-name" class="input" maxlength="30" value="${esc(d.name)}" data-bind="dialog.name" placeholder="${esc(t('te.namePlaceholder'))}"></div>
      ${color('bg', t('te.bg'))}
      ${color('accent', t('te.accent'))}
      ${color('text', t('te.text'))}
      ${d.lowContrast ? `<p class="warn small" role="alert">${esc(t('te.lowContrast'))}</p>` : ''}
      <div class="row between">
        <div class="row" style="gap:6px">
          ${d.id ? `<button type="button" class="btn sm" data-action="exportTheme">${esc(t('te.export'))}</button>
                    <button type="button" class="icon-btn" style="width:34px;height:34px" data-action="deleteTheme" aria-label="${esc(t('common.delete'))}" title="${esc(t('common.delete'))}">${icon.trash()}</button>` : ''}
        </div>
        <div class="row" style="gap:6px">
          <button type="button" class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
          <button type="submit" class="btn accent">${esc(t('common.save'))}</button>
        </div>
      </div></form></div>`;
  }
  if (d?.type === 'deleteWorld') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:nowrap">
        <span class="avatar" style="background:var(--warn-soft);color:var(--warn-text)">${icon.warn()}</span>
        <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('worlds.deleteTitle', { name: d.folder }))}</h2><p class="note">${esc(t('worlds.deleteText'))}</p></div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button class="btn" data-action="copyWorld" data-folder="${esc(d.folder)}">${esc(t('worlds.copy'))}</button>
        <button class="btn accent" data-action="deleteWorld" data-folder="${esc(d.folder)}">${esc(t('common.delete'))}</button>
      </div></div></div>`;
  }
  if (state.importing) {
    html += `<div class="toast" role="status"><div class="stack" style="gap:8px;min-width:260px"><span>${esc(t('inst.importing', state.importing))}</span>
      <div class="bar"><span style="width:${state.importing.total ? Math.round(state.importing.done / state.importing.total * 100) : 5}%"></span></div></div></div>`;
  }
  if (state.ctx) html += contextMenu();
  if (state.mods.dragging && state.view === 'instance' && state.instTab === 'mods') {
    html += `<div class="drop-hint">${icon.upload()}<span>${esc(t('mods.drop'))}</span></div>`;
  }
  if (state.toast) html += `<div class="toast ${state.toast.error ? 'error' : ''}" role="status">${esc(state.toast.text)}</div>`;
  $('#overlay').innerHTML = html;
}

/** Перерисовывает окно. scrollTop=true — прокрутить новый экран наверх. */
let lastView = null;
function render(scrollTop = false) {
  renderChrome();
  const content = $('#content');
  const keep = content.scrollTop;
  content.innerHTML = VIEWS[state.view]();
  // Плавное появление — только когда открылся другой экран, а не при каждом клике
  if (state.view !== lastView) content.firstElementChild?.classList.add('enter');
  lastView = state.view;
  content.scrollTop = scrollTop ? 0 : keep;
  paintSkins(content);
  renderOverlay();
}

// Отключаем «Сохранённые сведения» (автозаполнение Windows) во всех полях ввода
new MutationObserver(() => {
  document.querySelectorAll('input:not([data-noauto]), textarea:not([data-noauto])').forEach((el) => {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('data-noauto', '');
  });
}).observe(document.body, { childList: true, subtree: true });

// ---------- Поиск ----------

let searchTimer;
let searchSeq = 0;
async function runSearch() {
  const r = state.res;
  if (r.source !== 'modrinth') return;
  const target = state.instances.find((i) => i.id === r.targetId) || selected();
  const seq = ++searchSeq;
  r.loading = true; r.error = false;
  refreshResults();
  try {
    const results = await searchModrinth({ query: r.query, kind: r.kind, gameVersion: target?.gameVersion, loader: target?.loader });
    if (seq !== searchSeq) return; // пришёл ответ на старый запрос — пропускаем
    r.results = results;
  } catch {
    if (seq !== searchSeq) return;
    r.error = true;
  }
  r.loading = false;
  refreshResults();
}

/** Перерисовывает только результаты поиска, не трогая поле ввода. */
function refreshResults() {
  if (state.view !== 'resources') return;
  const box = $('#res-results');
  if (box) box.innerHTML = resultsHtml();
  else render();
}

// ---------- Запуск игры ----------

const LAUNCH_ERRORS = {
  ALREADY_RUNNING: () => t('launch.alreadyRunning'),
  ELY_RELOGIN: () => t('launch.relogin'),
  PRE_LAUNCH_FAILED: () => t('launch.preLaunchFailed'),
  MS_RELOGIN: () => t('launch.msRelogin'),
  MS_NOT_CONFIGURED: () => t('acc.msPendingSub'),
};

const stopping = new Set();

async function launch(id) {
  if (state.progress[id] || state.running.has(id)) return;
  if (!activeAccount()) {
    state.dialog = { type: 'noAccount' };
    renderOverlay();
    return;
  }
  state.progress[id] = { stage: 'account', done: 0, total: 1 };
  render();
  try {
    await api.launch(id);
  } catch (e) {
    delete state.progress[id];
    const code = String(e);
    const inst = state.instances.find((i) => i.id === id);
    if (code === 'NO_ACCOUNT') { state.dialog = { type: 'noAccount' }; }
    else if (code.startsWith('NO_LOADER_FOR_VERSION')) toast(t('launch.noLoaderVersion', { loader: t('loader.' + (inst?.loader || 'fabric')), version: inst?.gameVersion }), true);
    else if (code.startsWith('LOADER_INSTALL_FAILED')) state.dialog = { type: 'crash', id, log: code.replace(/^LOADER_INSTALL_FAILED:\s*/, '') };
    else if (code.startsWith('JAVA_START_FAILED')) toast(t('launch.javaFailed'), true);
    else if (LAUNCH_ERRORS[code]) toast(LAUNCH_ERRORS[code](), true);
    else toast(t('launch.failed', { message: code }), true);
    if (code === 'ELY_RELOGIN' || code === 'MS_RELOGIN') { state.view = 'accounts'; }
  }
  render();
}

function subscribe() {
  on('launch-progress', (p) => {
    state.progress[p.instanceId] = p;
    // Перерисовываем только полоску прогресса, если она уже на экране, — так меньше нагрузки.
    const bar = document.querySelector('.hero .launch-status');
    if (bar && state.view === 'home' && selected()?.id === p.instanceId) {
      bar.outerHTML = progressBar(p.instanceId);
    } else if (state.view === 'home' || state.view === 'instances') {
      render();
    }
  });
  on('game-state', (g) => {
    delete state.progress[g.instanceId];
    if (g.running) {
      state.running.add(g.instanceId);
      const inst = state.instances.find((i) => i.id === g.instanceId);
      celebrate('ready', t('notify.readyTitle'), t('notify.readyBody', { name: inst?.name || 'Minecraft' }));
    } else {
      state.running.delete(g.instanceId);
      const byUser = stopping.delete(g.instanceId);
      if (!byUser && g.exitCode && g.exitCode !== 0) state.dialog = { type: 'crash', id: g.instanceId, log: g.log };
    }
    render();
  });
  on('import-progress', (p) => {
    state.importing = p.done < p.total ? p : null;
    renderOverlay();
  });
  on('prism-progress', (p) => {
    if (state.dialog?.type === 'prism') { state.dialog.progress = p; renderOverlay(); }
  });
  on('backup-state', (b) => {
    // Копия миров после игры: просто обновим список, если он открыт
    if (!b.running && state.backups.id === b.instanceId) { state.backups.list = null; if (state.view === 'instance') render(); }
  });
  on('update-progress', (u) => {
    state.updating = u;
    renderOverlay();
  });
}

async function afterCoverChange(inst) {
  await loadInstances();
  if (state.edit?.id === inst.id) state.edit.coverImage = inst.coverImage;
  render();
}

async function importFlow(path) {
  try {
    const inst = await api.importMrpack(path);
    state.importing = null;
    if (!inst) return renderOverlay();
    await loadInstances();
    state.selectedId = inst.id;
    state.view = 'home';
    render(true);
    toast(t('inst.imported', { name: inst.name }));
    celebrate('done', t('notify.doneTitle'), t('inst.imported', { name: inst.name }));
  } catch (e) {
    state.importing = null;
    toast(String(e) === 'NOT_MRPACK' ? t('inst.notMrpack') : t('error.generic', { message: e }), true);
  }
}

async function saveQuick(inst) {
  try {
    await api.updateInstance(inst);
    await loadInstances();
    if (state.edit?.id === inst.id) Object.assign(state.edit, { name: inst.name, tint: inst.tint, favorite: inst.favorite, archived: inst.archived, backupWorlds: inst.backupWorlds });
  } catch (e) { toast(t('error.generic', { message: e }), true); }
}

async function doSaveInstance() {
  try {
    await api.updateInstance(state.edit);
    await loadInstances();
    toast(t('common.saved'));
    go(state.back === 'instance' ? 'home' : state.back);
  } catch (e) {
    toast(t('error.generic', { message: e }), true);
  }
}

// ---------- Действия кнопок ----------

const actions = {
  winMin: () => win.minimize(),
  winMax: () => win.toggleMaximize(),
  winClose: () => win.close(),

  nav: (d) => {
    go(d.view);
    if (d.view === 'resources' && !state.res.results) runSearch();
  },
  goBack: () => go(state.back && state.back !== state.view ? state.back : 'home'),
  soon: () => toast(t('common.comingSoon')),
  openUrl: (d) => openUrl(d.url),

  select: (d) => { state.selectedId = d.id; render(); },
  play: (d) => launch(d.id),
  playInstance: (d) => { state.selectedId = d.id; go('home'); launch(d.id); },
  stop: async (d) => {
    stopping.add(d.id); // игру закрыли сами — окошко с ошибкой показывать не нужно
    try { await api.stop(d.id); } catch (e) { stopping.delete(d.id); toast(t('error.generic', { message: e }), true); }
  },
  copyLog: async () => {
    try { await navigator.clipboard.writeText(state.dialog?.log || ''); toast(t('launch.copied')); } catch { /* не страшно */ }
  },

  openEly: () => {
    state.ely = { username: state.ely.username, password: '', totp: '', need2fa: false, busy: false, error: '' };
    state.dialog = { type: 'ely' };
    renderOverlay();
    $('#ely-login')?.focus();
  },
  elySubmit: async () => {
    const e = state.ely;
    if (e.busy) return;
    e.busy = true; e.error = ''; renderOverlay();
    try {
      state.accounts = await api.addElyAccount(e.username, e.password, e.need2fa ? e.totp : null);
      state.dialog = null;
      state.ely = { username: '', password: '', totp: '', need2fa: false, busy: false, error: '' };
      render();
      toast(t('acc.welcome', { name: activeAccount()?.name ?? '' }));
      return;
    } catch (err) {
      const code = String(err);
      if (code === 'ELY_2FA' && !e.need2fa) { e.need2fa = true; e.error = ''; }
      else if (code === 'ELY_2FA' || code === 'ELY_BAD_CREDENTIALS') e.error = t('acc.badCredentials');
      else if (code.startsWith('NETWORK')) e.error = t('acc.network');
      else e.error = code;
    }
    e.busy = false;
    renderOverlay();
    (e.need2fa ? $('#ely-totp') : $('#ely-pass'))?.focus();
  },
  setActiveAccount: async (d) => { state.accounts = await api.setActiveAccount(d.id); render(); },
  removeAccount: async (d) => { state.accounts = await api.removeAccount(d.id); render(); toast(t('acc.removed')); },
  msSoon: () => toast(t('acc.msSoon')),

  installUpdate: async () => {
    state.updating = { downloaded: 0, total: 0 };
    renderOverlay();
    try {
      await api.installUpdate(); // на Windows лаунчер закроется сам и откроется уже новым
    } catch (e) {
      state.updating = null;
      state.dialog = null;
      renderOverlay();
      toast(t('upd.failed', { message: e }), true);
    }
  },
  openFolder: async (d) => {
    if (!inApp) return toast(t('common.comingSoon'));
    try { await api.openInstanceFolder(d.id); } catch (e) { toast(t('error.generic', { message: e }), true); }
  },

  openCreate: () => {
    state.create = { ...state.create, mode: 'scratch', name: '' };
    go('create');
    if (!state.versions) loadVersions();
  },
  setCreateMode: (d) => { state.create.mode = d.mode; render(); },
  setTint: (d) => { state.create.tint = Number(d.n); render(); },
  setLoader: (d) => { state.create.loader = d.loader; state.create.loaderVersion = ''; render(); },
  toggleSnapshots: () => { state.create.snapshots = !state.create.snapshots; render(); },
  retryVersions: () => { state.versionsError = false; render(); loadVersions(); },
  catalogModpacks: () => { state.res.kind = 'modpack'; state.res.results = null; go('resources'); runSearch(); },
  createInstance: async () => {
    const c = state.create;
    try {
      const inst = await api.createInstance({ name: c.name.trim(), gameVersion: c.version, loader: c.loader, loaderVersion: c.loader === 'vanilla' ? '' : c.loaderVersion, tint: c.tint });
      await loadInstances();
      state.selectedId = inst.id;
      state.view = 'home';
      render(true);
      toast(t('create.done', { name: inst.name }));
    } catch (e) {
      toast(t('error.generic', { message: e }), true);
    }
  },

  openInstance: (d) => {
    const inst = state.instances.find((i) => i.id === d.id);
    if (!inst) return;
    state.edit = structuredClone(inst);
    state.advOpen = false;
    state.instTab = d.tab || 'general';
    state.editSnapshots = false;
    state.mods = { id: null, list: null, loading: false, query: '', dragging: false };
    if (!state.versions) loadVersions();
    go('instance');
  },
  toggleEdit: (d) => { state.edit[d.key] = !state.edit[d.key]; render(); },
  toggleAdv: () => { state.advOpen = !state.advOpen; render(); },
  resetEdit: () => {
    const inst = state.instances.find((i) => i.id === state.edit.id);
    if (inst) { state.edit = structuredClone(inst); render(); }
  },
  saveInstance: () => {
    const orig = state.instances.find((i) => i.id === state.edit.id);
    if (orig && (orig.gameVersion !== state.edit.gameVersion || orig.loader !== state.edit.loader)) {
      state.dialog = { type: 'confirmChange' };
      renderOverlay();
      return;
    }
    doSaveInstance();
  },
  askDelete: (d) => { state.dialog = { type: 'confirmDelete', id: d.id }; renderOverlay(); },
  closeDialog: () => {
    if (state.updating || state.dialog?.busy) return;
    const wasTheme = state.dialog?.type === 'themeEditor';
    state.dialog = null; renderOverlay();
    if (wasTheme) applySettings();
  },
  confirmDelete: async (d) => {
    state.dialog = null;
    try {
      await api.deleteInstance(d.id);
      await loadInstances();
      state.view = 'instances';
      render(true);
      toast(t('inst.deleted'));
    } catch (e) {
      toast(t('error.generic', { message: e }), true);
    }
  },

  setInstTab: (d) => {
    state.instTab = d.tab;
    if (d.tab === 'worlds') state.worlds.list = null;
    if (d.tab === 'screens') state.shots.list = null;
    if (d.tab === 'mods') state.mods.list = null;
    render();
  },
  install: async (d) => {
    const r = state.res;
    if (r.kind === 'datapack') {
      const target = state.instances.find((i) => i.id === r.targetId) || selected();
      if (!target) return toast(t('res.noTarget'), true);
      let worlds = [];
      try { worlds = await api.listWorlds(target.id); } catch { /* ниже скажем, что миров нет */ }
      if (!worlds.length) return toast(t('dp.noWorlds', { name: target.name }), true);
      state.dialog = { type: 'pickWorld', pid: d.pid, title: d.title, worlds, target: target.id, busy: null };
      return renderOverlay();
    }
    if (r.kind === 'modpack') {
      r.installing[d.pid] = true; render();
      try {
        const inst = await api.installModpack(d.pid);
        await loadInstances();
        state.selectedId = inst.id;
        toast(t('res.modpackDone', { name: inst.name }));
        celebrate('done', t('notify.doneTitle'), t('res.modpackDone', { name: inst.name }));
      } catch (e) { toast(t('error.generic', { message: e }), true); }
      delete r.installing[d.pid]; state.importing = null; render();
      return;
    }
    const target = state.instances.find((i) => i.id === r.targetId) || selected();
    if (!target) return toast(t('res.noTarget'), true);
    if (r.kind === 'mod' && target.loader === 'vanilla') return toast(t('res.vanillaTarget'), true);
    r.installing[d.pid] = true; refreshResults();
    try {
      const res = await api.installProject(target.id, d.pid);
      const [first, ...rest] = res.installed;
      toast(t('res.installedToast', { list: first || d.title }) + (rest.length ? '. ' + t('res.alsoInstalled', { list: rest.join(', ') }) : ''));
      r.installed.add(d.pid);
      if (state.mods.id === target.id) state.mods.list = null;
    } catch (e) {
      const code = String(e);
      if (code.startsWith('NO_COMPATIBLE_VERSION')) toast(t('res.noCompatible', { name: code.split(':').slice(1).join(':') || d.title, version: target.gameVersion, loader: loaderLabel(target.loader) }), true);
      else toast(t('error.generic', { message: code }), true);
    }
    delete r.installing[d.pid]; refreshResults();
  },
  checkUpdates: async (d) => {
    state.mods.checking = true; render();
    try {
      const list = await api.checkModUpdates(d.id);
      if (!list.length) toast(t('mods.noUpdates'));
      else state.dialog = { type: 'updates', list, picked: new Set(list.map((_, n) => n)), busy: false };
    } catch (e) { toast(t('error.generic', { message: e }), true); }
    state.mods.checking = false; render();
  },
  applyUpdates: async () => {
    const d = state.dialog;
    d.busy = true; renderOverlay();
    try {
      const n = await api.applyModUpdates(state.edit.id, d.list.filter((_, i) => d.picked.has(i)));
      state.dialog = null;
      toast(t('mods.updDone', { n }));
      state.mods.list = null;
    } catch (e) { d.busy = false; toast(t('error.generic', { message: e }), true); }
    render();
  },
  share: async (d) => {
    state.ctx = null;
    if (!inApp) return toast(t('inst.exported', { path: 'сборка.mrpack' }));
    try {
      const path = await api.exportMrpack(d.id);
      if (path) toast(t('inst.exported', { path }));
    } catch (e) { toast(t('error.generic', { message: e }), true); }
    renderOverlay();
  },
  ctxShare: (d) => actions.share(d),
  importPack: () => importFlow(null),
  pickCover: async (d) => {
    if (!inApp) return toast(t('common.comingSoon'));
    try {
      const inst = await api.pickCover(d.id);
      if (inst) await afterCoverChange(inst);
    } catch (e) { toast(String(e) === 'BAD_IMAGE' ? t('cover.badImage') : t('error.generic', { message: e }), true); }
  },
  clearCover: async (d) => {
    try { await afterCoverChange(await api.clearCover(d.id)); } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  shotCover: async (d) => {
    try { await afterCoverChange(await api.coverFromScreenshot(state.edit.id, d.file)); toast(t('shots.coverDone')); }
    catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  openShot: async (d) => { try { await api.openScreenshot(state.edit.id, d.file); } catch (e) { toast(t('error.generic', { message: e }), true); } },
  deleteShot: async (d) => {
    try { await api.deleteScreenshot(state.edit.id, d.file); state.shots.list = state.shots.list.filter((x) => x.file !== d.file); render(); }
    catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  copyWorld: async (d) => {
    try {
      const name = await api.copyWorld(state.edit.id, d.folder, t('worlds.copySuffix'));
      toast(t('worlds.copied', { name }));
      if (state.dialog?.type === 'deleteWorld') state.dialog = null;
      state.worlds.list = null; render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  openWorld: async (d) => { try { await api.openWorldFolder(state.edit.id, d.folder); } catch (e) { toast(t('error.generic', { message: e }), true); } },
  askDeleteWorld: (d) => { state.dialog = { type: 'deleteWorld', folder: d.folder }; renderOverlay(); },
  deleteWorld: async (d) => {
    state.dialog = null;
    try { await api.deleteWorld(state.edit.id, d.folder); toast(t('worlds.deleted')); state.worlds.list = null; }
    catch (e) { toast(t('error.generic', { message: e }), true); }
    render();
  },
  setEditTint: (d) => { state.edit.tint = Number(d.n); render(); },
  setEditLoader: (d) => {
    if (state.edit.loader !== d.loader) { state.edit.loader = d.loader; state.edit.loaderVersion = ''; }
    render();
  },
  toggleEditSnapshots: () => { state.editSnapshots = !state.editSnapshots; render(); },
  retryLoaderVersions: (d) => { delete state.loaderVersions[d.key]; render(); },
  duplicate: async (d) => {
    try {
      const src = state.instances.find((i) => i.id === d.id);
      const copy = await api.duplicateInstance(d.id, src ? `${src.name} ${t('dup.suffix')}` : '');
      await loadInstances();
      toast(t('dup.done', { name: copy.name }));
      render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },

  toggleMod: async (d) => {
    try {
      const newName = await api.toggleMod(state.edit.id, d.file);
      const m = state.mods.list.find((x) => x.file === d.file);
      if (m) { m.file = newName; m.enabled = !m.enabled; }
      render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  deleteMod: async (d) => {
    try {
      await api.deleteMod(state.edit.id, d.file);
      state.mods.list = state.mods.list.filter((x) => x.file !== d.file);
      render();
      toast(t('mods.deleted'));
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  openModsFolder: async (d) => {
    if (!inApp) return toast(t('common.comingSoon'));
    try { await api.openInstanceFolder(d.id, 'mods'); } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  findMods: (d) => {
    Object.assign(state.res, { targetId: d.id, kind: 'mod', results: null });
    go('resources');
    runSearch();
  },

  closeCtx: () => { state.ctx = null; renderOverlay(); },
  ctxPlay: (d) => { state.ctx = null; state.selectedId = d.id; go('home'); launch(d.id); },
  ctxSettings: (d) => { state.ctx = null; renderOverlay(); actions.openInstance(d); },
  ctxFolder: (d) => { state.ctx = null; renderOverlay(); actions.openFolder(d); },
  ctxRename: (d) => {
    const inst = state.instances.find((i) => i.id === d.id);
    state.ctx = null;
    state.dialog = { type: 'rename', id: d.id, name: inst?.name ?? '' };
    renderOverlay();
    const el = $('#rename-input'); el?.focus(); el?.select();
  },
  ctxCover: (d) => { state.ctx = null; state.dialog = { type: 'cover', id: d.id }; renderOverlay(); },
  ctxDuplicate: (d) => { state.ctx = null; renderOverlay(); actions.duplicate(d); },
  ctxDelete: (d) => { state.ctx = null; state.dialog = { type: 'confirmDelete', id: d.id }; renderOverlay(); },
  renameSubmit: async () => {
    const d = state.dialog;
    const inst = state.instances.find((i) => i.id === d.id);
    if (!inst || !d.name.trim()) return;
    await saveQuick({ ...inst, name: d.name.trim() });
    state.dialog = null;
    render();
  },
  pickTint: async (d) => {
    const inst = state.instances.find((i) => i.id === state.dialog.id);
    if (!inst) return;
    await saveQuick({ ...inst, tint: Number(d.n) });
    render();
  },
  changeJust: () => { state.dialog = null; doSaveInstance(); },
  changeCopy: async () => {
    state.dialog = null;
    const orig = state.instances.find((i) => i.id === state.edit.id);
    try { await api.duplicateInstance(state.edit.id, orig ? `${orig.name} ${t('dup.suffix')}` : ''); } catch (e) { return toast(t('error.generic', { message: e }), true); }
    doSaveInstance();
  },

  setKind: (d) => { state.res.kind = d.kind; state.res.results = null; runSearch(); render(); },
  setSource: (d) => { state.res.source = d.source; render(); if (d.source === 'modrinth' && !state.res.results) runSearch(); },
  search: () => runSearch(),

  // ---------- 0.5: датапаки ----------
  installToWorld: async (d) => {
    const dlg = state.dialog;
    if (dlg.busy) return;
    dlg.busy = d.world; renderOverlay();
    try {
      const res = await api.installProject(dlg.target, dlg.pid, d.world);
      state.dialog = null;
      toast(t('dp.installed', { name: res.installed[0] || dlg.title, world: d.world }));
      if (state.dp.world === d.world) state.dp.list = null;
    } catch (e) {
      dlg.busy = null;
      const code = String(e);
      const inst = state.instances.find((i) => i.id === dlg.target);
      if (code.startsWith('NO_COMPATIBLE_VERSION')) toast(t('res.noCompatible', { name: dlg.title, version: inst?.gameVersion, loader: t('res.kind.datapack') }), true);
      else toast(t('error.generic', { message: code }), true);
    }
    renderOverlay();
  },
  toggleDatapacks: (d) => {
    if (state.dp.world === d.folder) { state.dp = { world: null, list: null }; render(); }
    else loadDatapacks(d.folder);
  },
  deleteDatapack: async (d) => {
    try {
      await api.deleteDatapack(state.edit.id, state.dp.world, d.file);
      state.dp.list = state.dp.list.filter((x) => x.file !== d.file);
      toast(t('dp.deleted'));
      render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  findDatapacks: () => {
    Object.assign(state.res, { targetId: state.edit.id, kind: 'datapack', results: null });
    go('resources');
    runSearch();
  },

  // ---------- 0.5: копии миров ----------
  toggleAutoBackup: async () => {
    const inst = state.instances.find((i) => i.id === state.edit.id);
    state.edit.backupWorlds = !state.edit.backupWorlds;
    render();
    if (inst) await saveQuick({ ...inst, backupWorlds: state.edit.backupWorlds });
  },
  makeBackup: async (d) => {
    state.backups.busy = d.folder; render();
    try {
      await api.makeBackup(state.edit.id, d.folder);
      toast(t('bk.made', { name: d.folder }));
      state.backups.list = null;
    } catch (e) { toast(t('error.generic', { message: e }), true); }
    state.backups.busy = null; render();
  },
  askRestore: (d) => {
    const b = state.backups.list.find((x) => x.file === d.file);
    if (!b) return;
    const date = new Date(b.time * 1000).toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    state.dialog = { type: 'restore', file: b.file, world: b.world, date, busy: false };
    renderOverlay();
  },
  restoreBackup: async (d) => {
    const dlg = state.dialog;
    if (state.running.has(state.edit.id)) return toast(t('bk.closeGame'), true);
    dlg.busy = true; renderOverlay();
    try {
      const world = await api.restoreBackup(state.edit.id, d.file);
      state.dialog = null;
      toast(t('bk.restored', { name: world }));
      state.worlds.list = null; state.backups.list = null;
    } catch (e) { dlg.busy = false; toast(t('error.generic', { message: e }), true); }
    render();
  },
  deleteBackup: async (d) => {
    try { await api.deleteBackup(state.edit.id, d.file); state.backups.list = state.backups.list.filter((x) => x.file !== d.file); render(); }
    catch (e) { toast(t('error.generic', { message: e }), true); }
  },

  // ---------- 0.5: перенос из Prism ----------
  openPrism: async () => {
    state.dialog = { type: 'prism', list: null, picked: new Set(), busy: false, progress: null };
    renderOverlay();
    try {
      const list = await api.findPrism();
      if (state.dialog?.type !== 'prism') return;
      state.dialog.list = list;
      state.dialog.picked = new Set(list.map((_, n) => n));
    } catch (e) {
      if (state.dialog?.type === 'prism') state.dialog.list = [];
      toast(t('error.generic', { message: e }), true);
    }
    renderOverlay();
  },
  prismAll: () => {
    const d = state.dialog;
    d.picked = d.picked.size === d.list.length ? new Set() : new Set(d.list.map((_, n) => n));
    renderOverlay();
  },
  prismImport: async () => {
    const d = state.dialog;
    d.busy = true; renderOverlay();
    try {
      const n = await api.importPrism(d.list.filter((_, i) => d.picked.has(i)).map((x) => x.path));
      state.dialog = null;
      await loadInstances();
      state.instFilter = 'all';
      render();
      toast(t('prism.done', { n }));
      celebrate('done', t('notify.doneTitle'), t('prism.done', { n }));
    } catch (e) {
      d.busy = false; renderOverlay();
      toast(t('error.generic', { message: e }), true);
    }
  },

  // ---------- 0.5: избранное, папки, теги, архив ----------
  setInstFilter: (d) => { state.instFilter = d.f; render(); },
  toggleFavorite: async (d) => {
    state.ctx = null;
    const inst = state.instances.find((i) => i.id === d.id);
    if (inst) await saveQuick({ ...inst, favorite: !inst.favorite });
    render();
  },
  toggleArchive: async (d) => {
    state.ctx = null;
    const inst = state.instances.find((i) => i.id === d.id);
    if (!inst) return renderOverlay();
    await saveQuick({ ...inst, archived: !inst.archived });
    toast(t(inst.archived ? 'org.unarchived' : 'org.archivedToast', { name: inst.name }));
    if (state.selectedId === inst.id && !inst.archived) state.selectedId = null;
    render();
  },
  addTag: () => {
    const tag = (state.tagDraft || '').trim().slice(0, 24);
    if (!tag) return;
    const tags = state.edit.tags || (state.edit.tags = []);
    if (!tags.some((g) => g.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    state.tagDraft = '';
    render();
    $('#etag')?.focus();
  },
  removeTag: (d) => { state.edit.tags = (state.edit.tags || []).filter((g) => g !== d.tag); render(); },

  // ---------- 0.5: Microsoft ----------
  goAccounts: () => { state.dialog = null; go('accounts'); },
  msLogin: async () => {
    if (state.msBusy) return;
    state.msBusy = true; render();
    try {
      state.accounts = await api.addMicrosoftAccount();
      state.skins.accountFor = null;
      toast(t('acc.welcome', { name: activeAccount()?.name ?? '' }));
    } catch (e) {
      const code = String(e).split(':')[0];
      const known = ['MS_CANCELLED', 'MS_TIMEOUT', 'MS_NO_XBOX', 'MS_CHILD', 'MS_XBOX_REGION', 'MS_ADULT_VERIFY', 'MS_NOT_APPROVED', 'MS_NOT_CONFIGURED', 'MS_NO_GAME', 'MS_BAD_STATE', 'NETWORK'];
      toast(known.includes(code) ? t('acc.err.' + code) : t('error.generic', { message: e }), true);
    }
    state.msBusy = false; render();
  },

  // ---------- 0.5: скины ----------
  skinPick: (d) => { state.skins.pick = state.skins.pick === d.file ? null : d.file; render(); },
  skinUnpick: () => { state.skins.pick = null; render(); },
  importSkin: async () => {
    if (!inApp) return toast(t('common.comingSoon'));
    try {
      const list = await api.importSkin();
      if (list) { state.skins.library = list; state.skins.pick = list[0]?.file || null; render(); toast(t('skins.added')); }
    } catch (e) { toast(String(e) === 'NOT_A_SKIN' ? t('skins.notSkin') : t('error.generic', { message: e }), true); }
  },
  saveCurrentSkin: async () => {
    const cur = state.skins.account;
    const acc = activeAccount();
    if (!cur?.image || !acc) return;
    try {
      state.skins.library = await api.saveSkinData(cur.image, acc.name, cur.slim);
      toast(t('skins.saved'));
      render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  skinSetSlim: async (d) => {
    const k = state.skins.library.find((x) => x.file === state.skins.pick);
    if (!k) return;
    try { state.skins.library = await api.updateSkin(k.file, k.name, d.slim === '1'); render(); } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  renameSkin: () => {
    const k = state.skins.library.find((x) => x.file === state.skins.pick);
    if (!k) return;
    state.dialog = { type: 'renameSkin', file: k.file, name: k.name };
    renderOverlay();
    const el = $('#rename-input'); el?.focus(); el?.select();
  },
  renameSkinSubmit: async () => {
    const d = state.dialog;
    const k = state.skins.library.find((x) => x.file === d.file);
    if (!k || !d.name.trim()) return;
    try { state.skins.library = await api.updateSkin(k.file, d.name.trim(), k.slim); } catch (e) { toast(t('error.generic', { message: e }), true); }
    state.dialog = null;
    render();
  },
  deleteSkin: async () => {
    try {
      state.skins.library = await api.deleteSkin(state.skins.pick);
      state.skins.pick = null;
      render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  applySkin: async () => {
    const acc = activeAccount();
    if (!acc || state.skins.busy) return;
    state.skins.busy = true; render();
    try {
      await api.applySkin(acc.id, state.skins.pick);
      toast(t('skins.applied'));
      state.skins.pick = null;
      state.skins.accountFor = null; // перечитаем скин с серверов
    } catch (e) {
      const code = String(e);
      toast(code === 'ELY_SITE' ? t('skins.elyApplyNote') : code.startsWith('NETWORK') ? t('acc.err.NETWORK') : t('skins.applyFailed', { message: code }), true);
    }
    state.skins.busy = false; render();
  },
  setCape: async (d) => {
    const acc = activeAccount();
    if (!acc) return;
    try {
      await api.setCape(acc.id, d.cape || null);
      for (const c of state.skins.account.capes) c.active = c.id === d.cape;
      render();
      toast(t(d.cape ? 'skins.capeOn' : 'skins.capeOff'));
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },

  // ---------- 0.5: внешний вид ----------
  setSetTab: (d) => { state.setTab = d.tab; render(); },
  setAccent: (d) => { state.settings.accent = d.color; applySettings(); render(); saveSettings(); },
  setDensity: (d) => { state.settings.density = d.d; applySettings(); render(); saveSettings(); },
  resetLook: () => {
    Object.assign(state.settings, { uiScale: 1, textScale: 1, radiusScale: 1, density: 'normal' });
    applySettings(); render(); saveSettings();
  },
  pickBackground: async () => {
    if (!inApp) return toast(t('common.comingSoon'));
    try {
      const path = await api.pickBackground();
      if (!path) return;
      state.settings.background = { dim: 65, blur: 8, ...(state.settings.background || {}), path };
      applySettings(); render(); saveSettings();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  clearBackground: () => { state.settings.background = null; applySettings(); render(); saveSettings(); },
  newTheme: () => {
    const cur = resolveTheme(state.settings);
    state.dialog = { type: 'themeEditor', id: '', name: '', bg: cur.bg.startsWith('#') ? cur.bg : '#170B15', accent: cur.accent, text: cur.text };
    renderOverlay();
    $('#te-name')?.focus();
  },
  editTheme: () => {
    const c = (state.settings.customThemes || []).find((x) => 'custom:' + x.id === state.settings.theme);
    if (!c) return;
    state.dialog = { type: 'themeEditor', ...c };
    renderOverlay();
  },
  saveTheme: () => {
    const d = state.dialog;
    const list = state.settings.customThemes || (state.settings.customThemes = []);
    const theme = { id: d.id || 't' + Date.now().toString(36), name: d.name.trim() || t('te.namePlaceholder'), bg: d.bg, accent: d.accent, text: d.text };
    const at = list.findIndex((x) => x.id === theme.id);
    if (at >= 0) list[at] = theme; else list.push(theme);
    state.settings.theme = 'custom:' + theme.id;
    state.settings.accent = '';
    state.dialog = null;
    applySettings(); render(); saveSettings();
    toast(t('te.saved', { name: theme.name }));
  },
  deleteTheme: () => {
    const d = state.dialog;
    state.settings.customThemes = (state.settings.customThemes || []).filter((x) => x.id !== d.id);
    if (state.settings.theme === 'custom:' + d.id) state.settings.theme = 'sakura';
    state.dialog = null;
    applySettings(); render(); saveSettings();
  },
  exportTheme: async () => {
    const d = state.dialog;
    const json = JSON.stringify({ spectiaTheme: 1, name: d.name, bg: d.bg, accent: d.accent, text: d.text }, null, 2);
    try {
      if (!inApp) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = (d.name || 'theme') + '.spectia-theme.json';
        a.click();
        return;
      }
      const path = await api.exportTheme(d.name || 'theme', json);
      if (path) toast(t('te.exported', { path }));
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  importTheme: () => $('#theme-file')?.click(),
  testChime: () => chime('ready', (state.settings.soundVolume ?? 60) / 100),
  toggleOn: (d) => {
    // Настройки, которые по умолчанию включены (undefined = включено)
    state.settings[d.key] = state.settings[d.key] === false;
    render(); saveSettings();
  },
  setAfterClose: (d) => { state.settings.afterGameClose = d.v; render(); saveSettings(); },

  setTheme: (d) => { state.settings.theme = d.theme; applySettings(); render(); saveSettings(); },
  toggleSetting: (d) => {
    state.settings[d.key] = !state.settings[d.key];
    applySettings(); render(); saveSettings();
  },
};

// Что делать при выборе в выпадающем списке (data-change="…")
const changes = {
  createVersion: () => { state.create.loaderVersion = ''; render(); },
  editVersion: () => { state.edit.loaderVersion = ''; render(); },
  setLanguage: (value) => { state.settings.language = value; applySettings(); render(); saveSettings(); },
  setTarget: (value) => { state.res.targetId = value; state.res.results = null; runSearch(); },
};

// ---------- Подписка на события (один раз на всё окно) ----------

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  // Клик внутри окошка не должен закрывать его
  if (el.classList.contains('overlay') && ev.target.closest('[data-stop]')) return;
  if (el.tagName === 'A') ev.preventDefault();
  const fn = actions[el.dataset.action];
  if (fn) fn(el.dataset, el);
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (!el.dataset.bind) return;
  const value = 'number' in el.dataset ? Number(el.value) / Number(el.dataset.scale || 1) : el.value;
  setPath(el.dataset.bind, value);
  if (el.id === 'mem') $('#mem-label').textContent = value + ' ' + t('unit.gb');
  const out = el.type === 'range' && document.getElementById(el.id + '-out');
  if (out) out.textContent = el.value + (el.dataset.unit || '');
  if ('live' in el.dataset) applyAppearance(state.settings);
  if ('liveTheme' in el.dataset && state.dialog?.type === 'themeEditor') {
    const d = state.dialog;
    applyAppearance(state.settings, d);
    el.parentElement.querySelector('.mono').textContent = el.value;
    // Предупредим, если текст плохо читается на фоне
    const low = Math.abs(lumOf(d.text) - lumOf(d.bg)) < 0.4;
    if (low !== !!d.lowContrast) { d.lowContrast = low; renderOverlay(); }
  }
  if ('filterMods' in el.dataset) filterModRows();
  if ('search' in el.dataset) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 350);
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.upd !== undefined && state.dialog?.type === 'updates') {
    const n = Number(el.dataset.upd);
    if (el.checked) state.dialog.picked.add(n); else state.dialog.picked.delete(n);
    renderOverlay();
    return;
  }
  if (el.dataset.prism !== undefined && state.dialog?.type === 'prism') {
    const n = Number(el.dataset.prism);
    if (el.checked) state.dialog.picked.add(n); else state.dialog.picked.delete(n);
    renderOverlay();
    return;
  }
  if ('accentPicker' in el.dataset) { actions.setAccent({ color: el.value }); return; }
  if (el.id === 'theme-file' && el.files?.[0]) {
    const file = el.files[0];
    file.text().then((text) => {
      const data = JSON.parse(text);
      const ok = (c) => /^#[0-9a-f]{6}$/i.test(c);
      if (!ok(data.bg) || !ok(data.accent) || !ok(data.text)) throw new Error('bad');
      const theme = { id: 't' + Date.now().toString(36), name: String(data.name || file.name).slice(0, 30), bg: data.bg, accent: data.accent, text: data.text };
      (state.settings.customThemes ||= []).push(theme);
      state.settings.theme = 'custom:' + theme.id;
      applySettings(); render(); saveSettings();
      toast(t('te.imported', { name: theme.name }));
    }).catch(() => toast(t('te.badFile'), true));
    el.value = '';
    return;
  }
  if (el.dataset.change) changes[el.dataset.change]?.(el.value);
  if (el.dataset.bind && el.tagName === 'SELECT') setPath(el.dataset.bind, el.value);
  if ('saveSettings' in el.dataset) {
    if (el.type === 'range') { applySettings(); if (el.id === 'bkkeep') render(); }
    saveSettings();
  }
});

// Своё меню по правой кнопке вместо системного «Назад / Обновить / Печать»
document.addEventListener('contextmenu', (ev) => {
  const field = ev.target.closest('input, textarea');
  if (field) return; // в полях ввода оставляем обычное меню (копировать / вставить)
  ev.preventDefault();
  const card = ev.target.closest('[data-ctx]');
  if (card) {
    state.ctx = { id: card.dataset.ctx, x: ev.clientX, y: ev.clientY };
    renderOverlay();
    document.querySelector('.ctx button')?.focus();
  } else if (state.ctx) {
    actions.closeCtx();
  }
});

// Перетаскивание .jar-файлов в окно → в моды открытой сборки
onFileDrop(async (p) => {
  const onMods = state.view === 'instance' && state.instTab === 'mods' && state.edit && state.edit.loader !== 'vanilla';
  if (p.type === 'drop' && !onMods) {
    const pack = (p.paths || []).find((f) => /\.mrpack$/i.test(f));
    if (pack) importFlow(pack);
    return;
  }
  if (!onMods) return;
  if (p.type === 'enter' || p.type === 'over') {
    if (!state.mods.dragging) { state.mods.dragging = true; renderOverlay(); }
  } else if (p.type === 'leave') {
    state.mods.dragging = false; renderOverlay();
  } else if (p.type === 'drop') {
    state.mods.dragging = false;
    try {
      const n = await api.addMods(state.edit.id, p.paths || []);
      toast(t('mods.added', { n }));
      await loadMods(state.edit.id);
    } catch (e) { toast(t('error.generic', { message: e }), true); }
    renderOverlay();
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-submit]');
  if (!form) return;
  ev.preventDefault();
  actions[form.dataset.submit]?.();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.ctx) actions.closeCtx();
  else if (ev.key === 'Escape' && state.dialog) actions.closeDialog();
});

// ---------- Запуск ----------

const startedAt = performance.now();

async function init() {
  try {
    state.settings = await api.getSettings();
  } catch {
    state.settings = { theme: 'sakura', language: 'ru', reduceMotion: false, hideOnLaunch: true, checkUpdates: true, autoJava: true, curseforgeKey: '' };
  }
  applySettings();
  subscribe();
  try { await loadInstances(); } catch (e) { toast(t('error.generic', { message: e }), true); }
  try { state.dataDir = await api.dataDir(); } catch { /* без обложек тоже можно */ }
  try { state.accounts = await api.listAccounts(); } catch { /* без аккаунтов тоже можно жить */ }
  try { state.running = new Set(await api.runningInstances()); } catch { /* ничего */ }
  try { state.msReady = await api.microsoftReady(); } catch { /* старый бэкенд */ }
  render();
  if (state.settings.checkUpdates) {
    api.checkUpdate().then((u) => {
      if (u) { state.update = u; state.dialog = state.dialog || { type: 'update' }; renderOverlay(); }
    }).catch(() => { /* нет интернета или GitHub недоступен — проверим в следующий раз */ });
  }
  document.body.classList.add('ready');
  // Убираем заставку: не раньше чем через 0,9 с (чтобы анимация успела), но и не задерживаем дольше
  const splash = $('#splash');
  if (splash) {
    const wait = state.settings.reduceMotion ? 0 : Math.max(0, 900 - (performance.now() - startedAt));
    setTimeout(() => { splash.classList.add('hide'); setTimeout(() => splash.remove(), 500); }, wait);
  }
  loadVersions(); // заранее, чтобы экран «Новая сборка» открывался мгновенно
}

init();
