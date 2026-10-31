// Spectia — главный файл интерфейса.
//
// Как это устроено:
//  • Всё, что видно на экране, описано в объекте `state`.
//  • Функции view* превращают state в HTML.
//  • Кнопки помечены data-action="…", а их обработчики лежат в объекте `actions`.
//  • Поля ввода помечены data-bind="путь.в.state" и сами записывают туда значение.

import { api, win, openUrl, inApp, on, onFileDrop, fileUrl } from './api.js';
import { renderDecorations } from './decorations.js';
import { t, setLang, getLang, LANGS, formatNumber } from './i18n.js';
import { THEMES, THEME_ORDER, TINTS } from './themes.js';
import { applyAppearance, applyZoom, resolveTheme, themeFromColors, lum as lumOf } from './appearance.js';
import { chime } from './sound.js';
import { setPet, petMood, setAquarium } from './pet.js';
import { skinCanvas, paintSkins, faceCanvas } from './skinview.js';
import { icon, heroArt, tintIcon, pixelScene } from './icons.js';
import { searchModrinth, CATEGORIES, projectDetails, trending } from './modrinth.js';
import { diagnose, crashDescription, lineLevel } from './doctor.js';
import { ACHIEVEMENTS, SEASONAL, PERFECT, TIERS, artSvg, facts, newlyUnlocked, wrappedYear, wrappedData, find as findAch, tierOf } from './achievements.js';
import { matchScore } from './search.js';
import { startTour } from './tour.js';
import { initDownloads, onNetStats, onLaunchProgress, finish as finishDownload, dlButtonHtml, toggleDownloads, clearDownloads } from './downloads.js';

const APP_VERSION = '1.0.0';
const REPO_URL = 'https://github.com/bunnyKROJINK/spectia';
const LOADERS = ['vanilla', 'fabric', 'neoforge', 'forge', 'quilt'];
const RES_KINDS = ['mod', 'shader', 'resourcepack', 'datapack', 'modpack'];
const NAV = [
  { id: 'home', view: 'home', ic: 'box' },
  { id: 'resources', view: 'resources', ic: 'search' },
  { id: 'news', view: 'news', ic: 'news' },
  { id: 'music', view: 'music', ic: 'music' },
  { id: 'wiki', view: 'wiki', ic: 'book' },
  { id: 'skins', view: 'skins', ic: 'skin' },
  { id: 'settings', view: 'settings', ic: 'gear' },
];
// Экраны, где рядом с полоской иконок виден список сборок
const LIST_VIEWS = new Set(['home', 'instances', 'instance', 'create']);
// Каким пунктом меню подсвечивать каждый экран
const NAV_OF_VIEW = { book: '', wiki: 'wiki', home: 'home', instances: 'home', create: 'home', instance: 'home', resources: 'resources', news: 'news', music: 'music', skins: 'skins', settings: 'settings', accounts: '' };

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
  res: { query: '', kind: 'mod', source: 'modrinth', results: null, loading: false, error: false, targetId: null, installing: {}, installed: new Set(), installedFor: null, cats: [] },
  skins: { account: null, accountFor: null, library: null, pick: null, busy: false },
  tagDraft: '',
  // ---------- 0.6 ----------
  modSel: new Set(),       // выбранные моды для массовых действий
  modSort: 'name',         // name | added
  modView: 'list',         // list | history
  history: { id: null, list: null },
  deps: { id: null, list: null },
  logs: { id: null, data: null, filter: 'all', query: '', source: 'launcher' },
  news: { list: null, error: false, trend: null, tab: 'all' },
  music: { list: null, group: 'all', current: null, playing: false, shuffle: false },
  mini: false,
  palette: null,           // { query, sel } — окно Ctrl+K
  week: null,              // сессии для графика на главной
  bookPage: 'tiers',
  snaps: { id: null, list: null, busy: false },
  profiles: { id: null, list: null },
  instView: 'list',        // list | sky (созвездие)
  wiki: { query: '', results: null, loading: false, mods: null },
  faces: {},               // id аккаунта → картинка скина (для лица)
  ach: null,               // показанная плашка достижения
  wrapped: null,           // { slide } — открытые итоги года
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
const clockText = () => new Date().toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' });
setInterval(() => { const c = document.getElementById('clock'); if (c) c.textContent = clockText(); }, 10000);

/** Портал при переключении сборок */
function portal(then) {
  const el = document.getElementById('portal');
  if (!el || state.settings.reduceMotion || state.settings.portal === false || matchMedia('(prefers-reduced-motion: reduce)').matches) return then();
  el.classList.remove('go');
  void el.offsetWidth;
  el.classList.add('go');
  setTimeout(then, 260);
  setTimeout(() => el.classList.remove('go'), 700);
}

/** «Удиви меня»: случайная красивая тема (её можно сохранить в редакторе) */
function dreamTheme() {
  const r = (a, b) => a + Math.random() * (b - a);
  const hsl = (h, sat, l) => {
    const a = (sat / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n) => { const k = (n + h / 30) % 12; const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  const h = Math.floor(r(0, 360));
  const h2 = (h + r(30, 160)) % 360;
  const modes = ['glow', 'diagonal', 'vertical', 'glow'];
  const pats = ['', 'stars', 'dots', 'grid', 'pixels', ''];
  return {
    bg: hsl(h, r(30, 55), r(6, 10)), bg2: hsl(h2, r(30, 55), r(8, 14)), bgMode: modes[Math.floor(r(0, modes.length))],
    accent: hsl((h + r(140, 220)) % 360, r(70, 95), r(62, 72)), accent2: Math.random() > 0.35 ? hsl((h + r(60, 120)) % 360, r(70, 95), r(62, 72)) : '',
    text: hsl(h, 25, 93), card: '', pattern: pats[Math.floor(r(0, pats.length))], depth: Math.floor(r(1, 3)), glow: Math.round(r(30, 80) / 5) * 5,
  };
}

/** Лицо аккаунта: голова скина, а если скина нет — первая буква ника */
function faceHtml(acc, size = 36) {
  if (!acc) return `<span class="avatar" style="width:${size}px;height:${size}px">?</span>`;
  const img = state.faces[acc.id];
  if (img) return faceCanvas(img, size, acc.name);
  return `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;${acc.kind === 'ely' ? 'background:#207E5C' : ''}">${esc(acc.name.charAt(0).toUpperCase())}</span>`;
}

async function loadFaces() {
  for (const a of state.accounts) {
    if (a.id in state.faces) continue;
    state.faces[a.id] = '';
    api.accountSkin(a.id).then((sk) => { if (sk?.image) { state.faces[a.id] = sk.image; renderChrome(); if (state.view === 'accounts') render(); } }).catch(() => {});
  }
}

/** Значок сборки в списке: своя картинка или пиксельный пейзаж */
function instIcon(inst) {
  const url = coverUrl(inst);
  return url ? `<img src="${esc(url)}" alt="">` : tintIcon(inst?.tint || 0);
}

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
  document.documentElement.classList.toggle('jelly', state.settings.jelly !== false);
  setPet(state.settings.pet !== false, { running: state.running?.size > 0 });
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
    ${p.stage === 'assets' ? `<span class="small" style="opacity:.8">${esc(t('launch.firstTime'))}</span>` : ''}
    ${p.stage === 'java' ? `<span class="small" style="opacity:.8">${esc(t('launch.javaHint'))}</span>` : ''}
  </div>`;
}

// ---------- Экраны ----------

/** Сколько модов и миров в сборке — подгружаем один раз для главной */
const homeInfo = {};
function loadHomeInfo(inst) {
  if (homeInfo[inst.id]) return homeInfo[inst.id];
  homeInfo[inst.id] = { mods: null, worlds: null };
  const done = () => { if (state.view === 'home' && selected()?.id === inst.id) render(); };
  if (inst.loader === 'vanilla') homeInfo[inst.id].mods = 0;
  else api.listMods(inst.id).then((l) => { homeInfo[inst.id].mods = l.filter((m) => m.enabled).length; done(); }).catch(() => {});
  api.listWorlds(inst.id).then((l) => { homeInfo[inst.id].worlds = l.length; done(); }).catch(() => {});
  if (state.history.id !== inst.id && !state.history.loading) loadHistory(inst.id);
  return homeInfo[inst.id];
}

const HIST_TAG = { installed: ['+', '#4ED39A'], added: ['+', '#4ED39A'], appeared: ['+', '#4ED39A'], updated: ['↑', 'var(--accent-text)'], enabled: ['●', 'var(--accent-text)'], disabled: ['○', 'var(--muted)'], removed: ['−', 'var(--warn-text)'], vanished: ['−', 'var(--warn-text)'], restored: ['↺', '#4ED39A'], snapshot: ['↺', 'var(--accent-text)'], profile: ['◆', 'var(--accent-text)'] };

function viewHome() {
  const cur = selected();
  if (!cur) {
    return `<div class="view">
      <section class="hero" style="min-height:300px">${pixelScene(0)}
        <div class="hero-inner" style="min-height:300px">
          <div class="stack" style="gap:10px;max-width:520px">
            <span class="eyebrow-mono" style="color:#fff">Spectia</span>
            <h1>${esc(t('home.emptyTitle'))}</h1>
            <p style="color:#D9DCF2;line-height:1.5">${esc(t('home.emptySub'))}</p>
          </div>
          <div class="row"><button class="btn" data-action="openPrism">${icon.move()}<span>${esc(t('prism.button'))}</span></button>
          <button class="play" data-action="openCreate">${esc(t('home.newInstance'))}</button></div>
        </div>
      </section>
      ${findBlock()}
    </div>`;
  }
  const info = loadHomeInfo(cur);
  const last = cur.lastPlayed ? ago(cur.lastPlayed) : '';
  const stat = (label, value) => `<div class="panel stat"><span class="eyebrow-mono" style="font-size:calc(10px*var(--fs,1))">${esc(label)}</span><b>${esc(value)}</b></div>`;
  const hist = state.history.id === cur.id && Array.isArray(state.history.list) ? state.history.list.slice(0, 5) : null;
  const tabLink = (tab) => `<button data-action="openInstance" data-id="${esc(cur.id)}" data-tab="${tab}">${esc(t('is.tab.' + tab))}</button>`;
  return `<div class="view">
    ${wrappedBanner()}
    <section class="hero" aria-label="${esc(cur.name)}" style="${coverUrl(cur) ? coverBg(cur) : ''}">${coverUrl(cur) ? '' : pixelScene(cur.tint || 0)}
      <div class="hero-inner" style="min-height:250px">
        <div class="stack" style="gap:8px;min-width:0">
          ${last ? `<span class="chip" style="align-self:flex-start">${esc(t('home.lastPlayed', { when: last }))}</span>` : ''}
          <h1 class="ellipsis">${esc(cur.name)}</h1>
        </div>
        <div class="row">
          <button class="icon-btn" data-action="openFolder" data-id="${esc(cur.id)}" aria-label="${esc(t('is.openFolder'))}" title="${esc(t('is.openFolder'))}">${icon.folder(20)}</button>
          <button class="icon-btn" data-action="openInstance" data-id="${esc(cur.id)}" aria-label="${esc(t('home.instanceSettings'))}" title="${esc(t('home.instanceSettings'))}">${icon.gear()}</button>
          ${playButton(cur.id)}
        </div>
      </div>
      ${progressBar(cur.id)}
    </section>

    <div class="stats">
      ${stat(t('stat.version'), cur.gameVersion)}
      ${stat(t('stat.loader'), loaderLabel(cur.loader) + (cur.loaderVersion ? ' ' + cur.loaderVersion.replace(cur.gameVersion + '-', '').split('-')[0] : ''))}
      ${stat(t('stat.mods'), info.mods ?? '—')}
      ${stat(t('stat.worlds'), info.worlds ?? '—')}
      ${stat(t('stat.played'), formatPlayTime(cur.playTimeSecs))}
    </div>

    <div class="tabs" role="group" aria-label="${esc(t('is.title'))}">
      <button aria-selected="true">${esc(t('home.overview'))}</button>
      ${cur.loader !== 'vanilla' ? tabLink('mods') : ''}${tabLink('worlds')}${tabLink('screens')}${tabLink('logs')}${tabLink('launch')}
    </div>

    <div class="row" style="align-items:stretch;gap:16px">
      <section class="panel pad stack" style="flex:3 1 360px;min-width:0;gap:0" aria-label="${esc(t('home.recent'))}">
        <span class="eyebrow-mono" style="padding-bottom:8px">${esc(t('home.recent'))}</span>
        ${hist === null ? `<div class="row" style="padding:10px 0"><span class="spinner"></span></div>`
          : hist.length ? hist.map((ev) => {
            const [sym, color] = HIST_TAG[ev.action] || ['•', 'var(--muted)'];
            const tag = HIST_TAG[ev.action] ? sym + ' ' + t('hist.tag.' + ev.action) : sym;
            return `<div style="display:grid;grid-template-columns:84px minmax(0,1fr) auto;gap:12px;padding:10px 0;border-top:1px solid var(--line);align-items:center">
              <span class="hist-tag" style="color:${color}">${esc(tag)}</span><span class="ellipsis">${esc(ev.name)}${ev.action === 'updated' && ev.detail ? ` <span class="muted small">${esc(ev.detail)}</span>` : ''}</span><span class="small muted">${esc(ago(ev.time))}</span></div>`;
          }).join('')
          : `<p class="note" style="padding:10px 0;border-top:1px solid var(--line)">${esc(t('home.noRecent'))}</p>`}
      </section>
      <aside class="stack" style="flex:2 1 240px;min-width:0;gap:16px">
        ${doctorMini(cur)}
        ${cur.notes ? `<div class="panel pad stack" style="gap:6px"><span class="eyebrow-mono">${esc(t('org.notes'))}</span><span class="note" style="color:var(--text);white-space:pre-line">${esc(cur.notes)}</span></div>` : ''}
      </aside>
    </div>
    ${weekBlock()}
  </div>`;
}

/** Короткий статус от Spectia Doctor для главной */
function doctorMini(cur) {
  if (cur.loader !== 'vanilla' && state.deps.id !== cur.id) loadDeps(cur.id);
  const deps = state.deps.id === cur.id ? state.deps.list : null;
  const bad = deps && deps.length;
  return `<div class="panel pad ${bad ? 'warn-card' : 'ok-card'}" style="display:flex;gap:12px">
    <span style="color:${bad ? 'var(--warn-text)' : '#4ED39A'};flex-shrink:0">${bad ? icon.warn(18) : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'}</span>
    <span class="stack" style="gap:4px"><b>Spectia Doctor</b><span class="note">${esc(bad ? t('home.docDeps', { n: deps.length }) : t('home.docOk'))}</span>
    ${bad ? `<button class="btn sm" style="align-self:flex-start;margin-top:4px" data-action="openInstance" data-id="${esc(cur.id)}" data-tab="mods">${esc(t('news.openMods'))}</button>` : ''}</span>
  </div>`;
}

/** «Твоя неделя»: сколько играли за последние 7 дней — маленький столбчатый график */
function weekBlock() {
  if (state.week === null) { state.week = 'loading'; api.statsSessions().then((l) => { state.week = l; if (state.view === 'home') render(); }).catch(() => { state.week = []; }); return ''; }
  if (!Array.isArray(state.week)) return '';
  const DAY = 86400;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start0 = today.getTime() / 1000 - 6 * DAY;
  const days = Array.from({ length: 7 }, (_, n) => ({ t: start0 + n * DAY, secs: 0 }));
  const byInst = {};
  for (const ses of state.week) {
    const idx = Math.floor((ses.start - start0) / DAY);
    if (idx < 0 || idx > 6) continue;
    days[idx].secs += ses.seconds;
    byInst[ses.name] = (byInst[ses.name] || 0) + ses.seconds;
  }
  const total = days.reduce((a, d) => a + d.secs, 0);
  if (!total) return '';
  const max = Math.max(...days.map((d) => d.secs), 1);
  const top = Object.entries(byInst).sort((a, b) => b[1] - a[1])[0];
  const lang = document.documentElement.lang;
  return `<section class="panel pad-s stack" style="gap:12px" aria-label="${esc(t('week.title'))}">
    <div class="row between">
      <h2 class="h2-lg">${esc(t('week.title'))}</h2>
      <span class="small muted">${esc(t('week.total', { t: formatPlayTime(total) }))}${top ? ' · ' + esc(t('week.top', { name: top[0] })) : ''}</span>
    </div>
    <div class="week">${days.map((d) => `<div class="week-col" title="${esc(formatPlayTime(d.secs))}">
        <span class="week-bar" style="height:${Math.max(d.secs ? 6 : 2, Math.round((d.secs / max) * 100))}%"></span>
        <span class="small muted">${esc(new Date(d.t * 1000).toLocaleDateString(lang, { weekday: 'short' }))}</span>
      </div>`).join('')}</div>
  </section>`;
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
        <div class="seg" role="group" aria-label="${esc(t('sky.view'))}">
          <button data-action="setInstView" data-v="list" ${pressed(state.instView === 'list')}>${esc(t('sky.list'))}</button>
          <button data-action="setInstView" data-v="sky" ${pressed(state.instView === 'sky')}>${icon.stars(14)} ${esc(t('sky.title'))}</button>
        </div>
        <button class="btn" data-action="openCompare" ${state.instances.length < 2 ? 'disabled' : ''}>${icon.compare()}<span>${esc(t('cmp.button'))}</span></button>
        <button class="btn" data-action="openPrism">${icon.move()}<span>${esc(t('prism.button'))}</span></button>
        <button class="btn" data-action="importPack">${icon.upload(16)}<span>${esc(t('inst.import'))}</span></button>
        <button class="btn accent" data-action="openCreate">${esc(t('home.newInstance'))}</button>
      </div>
    </div>
    ${filters}
    ${state.instances.length
      ? list.length
        ? state.instView === 'sky' ? constellationHtml(list) : `<section class="panel list">${rows}</section>`
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
  const tabs = ['general', 'mods', 'worlds', 'screens', 'time', 'logs', 'launch'].map((k) =>
    `<button role="tab" aria-selected="${tab === k}" data-action="setInstTab" data-tab="${k}">${esc(t('is.tab.' + k))}</button>`).join('');

  let body = '';
  if (tab === 'general') body = instGeneral(e);
  if (tab === 'mods') body = instMods(e);
  if (tab === 'launch') body = instLaunch(e);
  if (tab === 'worlds') body = instWorlds(e);
  if (tab === 'screens') body = instShots(e);
  if (tab === 'logs') body = instLogs(e);
  if (tab === 'time') body = instTime(e);

  return `<div class="view">
    <div class="row" style="gap:14px">
      <button class="icon-btn" data-action="goBack" aria-label="${esc(t('common.back'))}">${icon.back()}</button>
      <span class="il-icon">${instIcon(e)}</span>
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

/** «3 дня назад», «вчера», «только что» */
function ago(secs) {
  if (!secs) return '';
  const d = Date.now() / 1000 - secs;
  if (d < 90) return t('ago.now');
  if (d < 3600) return t('ago.min', { n: Math.round(d / 60) });
  if (d < 86400) return t('ago.hour', { n: Math.round(d / 3600) });
  if (d < 172800) return t('ago.yesterday');
  if (d < 86400 * 30) return t('ago.days', { n: Math.round(d / 86400) });
  return new Date(secs * 1000).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long', year: 'numeric' });
}

function depsBanner(e) {
  const d = state.deps;
  if (d.id !== e.id) { loadDeps(e.id); return ''; }
  if (!d.list || !d.list.length) return '';
  return `<section class="panel pad stack warn-card" style="gap:8px">
    <div class="row" style="gap:10px;flex-wrap:nowrap"><span class="warn">${icon.warn()}</span><h2 class="h2">${esc(t('deps.title'))}</h2></div>
    ${d.list.map((p) => `<div class="row between" style="gap:10px">
      <span class="note" style="flex:1 1 300px">${esc(t(p.kind === 'missing' ? 'deps.missing' : 'deps.conflict', { name: p.title, who: p.neededBy.join(', ') }))}</span>
      ${p.kind === 'missing' ? `<button class="btn sm soft" data-action="installDep" data-pid="${esc(p.projectId)}" data-title="${esc(p.title)}" ${state.res.installing[p.projectId] ? 'disabled' : ''}>${state.res.installing[p.projectId] ? '<span class="spinner"></span>' : ''}${esc(t('deps.install'))}</button>` : ''}
    </div>`).join('')}
  </section>`;
}

const HISTORY_ICON = { installed: 'upload', updated: 'restore', removed: 'trash', enabled: 'play', disabled: 'box', added: 'upload', appeared: 'folder', vanished: 'trash' };

function modHistoryView(e) {
  const h = state.history;
  if (h.id !== e.id || h.list === null) {
    if (!h.loading) loadHistory(e.id);
    return `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  }
  if (!h.list.length) return `<section class="panel empty"><span class="muted">${esc(t('hist.empty'))}</span></section>`;
  let lastDay = '';
  const rows = h.list.map((ev) => {
    const day = new Date(ev.time * 1000).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long', year: 'numeric' });
    const head = day !== lastDay ? `<div class="folder-head">${esc(day)}</div>` : '';
    lastDay = day;
    const ic = icon[HISTORY_ICON[ev.action] || 'box'];
    return head + `<div class="list-row hist-row hist-${esc(ev.action)}">
      <span class="thumb mod-icon" style="width:34px;height:34px" aria-hidden="true">${ic(16)}</span>
      <div class="stack grow" style="gap:2px">
        <span><b>${esc(ev.name)}</b> <span class="muted">— ${esc(t('hist.' + ev.action))}</span></span>
        ${ev.detail ? `<span class="small muted ellipsis">${esc(ev.detail)}</span>` : ''}
      </div>
      ${ev.restore ? `<button class="btn sm" data-action="undoEvent" data-time="${ev.time}" data-restore="${esc(ev.restore)}">${icon.restore()}<span>${esc(t('hist.undo'))}</span></button>` : ''}
      <span class="small muted">${esc(new Date(ev.time * 1000).toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' }))}</span>
    </div>`;
  }).join('');
  return `<p class="note">${esc(t('hist.note'))}</p><section class="panel list">${rows}</section>`;
}

function instMods(e) {
  if (e.loader === 'vanilla') {
    return `<section class="panel empty">${icon.box()}<p class="note" style="max-width:460px">${esc(t('mods.vanilla'))}</p>
      <button class="btn" data-action="setInstTab" data-tab="general">${esc(t('is.tab.general'))}</button></section>`;
  }
  const m = state.mods;
  const viewSwitch = `<div class="seg" role="group" aria-label="${esc(t('mods.view'))}">
      <button data-action="setModView" data-v="list" ${pressed(state.modView === 'list')}>${esc(t('mods.viewList'))}</button>
      <button data-action="setModView" data-v="history" ${pressed(state.modView === 'history')}>${esc(t('mods.viewHistory'))}</button>
    </div>`;
  if (state.modView === 'history') return `<div class="row between">${viewSwitch}</div>` + modHistoryView(e);
  if (m.id !== e.id || m.list === null) {
    if (!m.loading) loadMods(e.id);
    return `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  }
  const list = [...m.list].sort(state.modSort === 'added'
    ? (a, b) => (b.added || 0) - (a.added || 0)
    : (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const on = m.list.filter((x) => x.enabled).length;
  const sel = state.modSel;
  const head = `<div class="row between">
      <div class="row" style="flex:1 1 280px">
        ${viewSwitch}
        <label for="modq" class="sr">${esc(t('mods.search'))}</label>
        <input id="modq" class="input" type="search" style="max-width:260px" placeholder="${esc(t('mods.search'))}" value="${esc(m.query)}" data-bind="mods.query" data-filter-mods>
        <label for="modsort" class="sr">${esc(t('mods.sort'))}</label>
        <select id="modsort" class="input" style="width:auto" data-change="setModSort">
          <option value="name" ${state.modSort === 'name' ? 'selected' : ''}>${esc(t('mods.sortName'))}</option>
          <option value="added" ${state.modSort === 'added' ? 'selected' : ''}>${esc(t('mods.sortAdded'))}</option>
        </select>
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
  const bulk = sel.size ? `<div class="bulk-bar row between">
      <span><b>${esc(t('bulk.selected', { n: sel.size }))}</b></span>
      <div class="row" style="gap:6px">
        <button class="btn sm" data-action="bulkMods" data-op="enable">${esc(t('bulk.enable'))}</button>
        <button class="btn sm" data-action="bulkMods" data-op="disable">${esc(t('bulk.disable'))}</button>
        <button class="btn sm" data-action="bulkMods" data-op="delete" style="color:var(--warn-text)">${icon.trash()}<span>${esc(t('common.delete'))}</span></button>
        <button class="btn sm" data-action="bulkClear">${esc(t('bulk.clear'))}</button>
      </div>
    </div>` : '';
  const allChecked = list.length && list.every((x) => sel.has(x.file));
  return head + depsBanner(e) + profilesBar(e) + bulk + `<section class="panel list" id="mods-list">
    <label class="check-row" style="padding:4px 12px"><input type="checkbox" data-selall ${allChecked ? 'checked' : ''}><span class="small muted">${esc(t('bulk.all'))}</span></label>
    ${list.map((x) => `<div class="list-row mod-row ${x.enabled ? '' : 'off'}" data-name="${esc(x.name)}" data-file="${esc(x.file)}" ${modMatches(x) ? '' : 'hidden'}>
      <input type="checkbox" class="mod-check" data-sel="${esc(x.file)}" ${sel.has(x.file) ? 'checked' : ''} aria-label="${esc(t('bulk.pick', { name: x.name }))}">
      <span class="thumb mod-icon" aria-hidden="true">${esc((x.name || '?').charAt(0).toUpperCase())}</span>
      <div class="stack grow" style="gap:2px">
        <span class="row" style="gap:8px"><span class="card-title" style="font-size:calc(14px*var(--fs,1))">${esc(x.name)}</span>${x.version ? `<span class="badge">${esc(x.version)}</span>` : ''}</span>
        ${x.description ? `<span class="small muted ellipsis" style="max-width:560px">${esc(x.description.split('\n')[0])}</span>` : ''}
        <span class="small muted ellipsis" style="opacity:.75">${esc(x.file)}${x.authors ? ' · ' + esc(t('mods.by', { who: x.authors })) : ''}${x.added ? ' · ' + esc(t('mods.added', { when: ago(x.added) })) : ''}</span>
      </div>
      <button class="switch-row" style="width:auto;min-height:44px" role="switch" aria-checked="${x.enabled}" aria-label="${esc(t('mods.toggle', { name: x.name }))}" data-action="toggleMod" data-file="${esc(x.file)}"><span class="switch"></span></button>
      <button class="icon-btn" data-action="deleteMod" data-file="${esc(x.file)}" aria-label="${esc(t('mods.delete', { name: x.name }))}" title="${esc(t('mods.delete', { name: x.name }))}">${icon.trash()}</button>
    </div>`).join('')}
  </section>`;
}

/** Находки Spectia Doctor в виде карточек */
function doctorCards(findings, recent = []) {
  if (!findings.length && !recent.length) return '';
  const cards = findings.map((f) => {
    const p = { ...f.params };
    if (p.list) p.list = p.list.map((x) => x.mod && x.need ? t('doc.pair', x) : x.mod && x.other ? t('doc.pairConflict', x) : '').filter(Boolean).join('; ');
    return `<div class="doc-card">
      <span class="doc-ico">${icon.warn(18)}</span>
      <div class="stack" style="gap:4px"><b>${esc(t('doc.' + f.id + '.title', p))}</b><span class="note">${esc(t('doc.' + f.id + '.text', p))}</span>
      ${p.list ? `<span class="small mono" style="opacity:.85">${esc(p.list)}</span>` : ''}</div>
    </div>`;
  }).join('');
  const changed = recent.length ? `<div class="doc-card soft">
      <span class="doc-ico">${icon.restore(18)}</span>
      <div class="stack" style="gap:4px"><b>${esc(t('doc.recent.title'))}</b><span class="note">${esc(t('doc.recent.text'))}</span>
      <span class="small">${recent.slice(0, 6).map((ev) => `${esc(ev.name)} — ${esc(t('hist.' + ev.action))} (${esc(ago(ev.time))})`).join('<br>')}</span></div>
    </div>` : '';
  return `<div class="stack" style="gap:8px">${cards}${changed}</div>`;
}

function instLogs(e) {
  const L = state.logs;
  if (L.id !== e.id || !L.data) {
    if (!L.loading) loadLogs(e.id);
    return `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  }
  const d = L.data;
  const text = L.source === 'crash' ? d.crash : L.source === 'latest' ? d.latest : d.launcher;
  const findings = diagnose(d.launcher, d.crash);
  const desc = crashDescription(d.crash);
  return `
    <section class="panel pad stack" style="gap:12px">
      <div class="row between">
        <div class="row" style="gap:10px;flex-wrap:nowrap"><span class="avatar" style="width:36px;height:36px;background:var(--accent-soft);color:var(--accent-text)">${icon.sparkle(18)}</span>
          <div class="stack" style="gap:2px"><h2 class="h2">Spectia Doctor</h2><span class="note">${esc(findings.length ? t('doc.found', { n: findings.length }) : t('doc.clean'))}</span></div></div>
        <button class="btn sm" data-action="reloadLogs">${icon.restore()}<span>${esc(t('logs.reload'))}</span></button>
      </div>
      ${desc ? `<p class="note">${esc(t('logs.crashDesc', { text: desc }))}</p>` : ''}
      ${doctorCards(findings, (state.history.id === e.id && state.history.list) ? state.history.list.filter((ev) => ev.time > (e.lastPlayed || 0) - 86400 * 2).slice(0, 6) : [])}
    </section>
    <section class="panel pad stack" style="gap:10px">
      <div class="row between">
        <div class="seg" role="group" aria-label="${esc(t('logs.source'))}">
          <button data-action="setLogSource" data-v="launcher" ${pressed(L.source === 'launcher')}>${esc(t('logs.src.launcher'))}</button>
          <button data-action="setLogSource" data-v="latest" ${pressed(L.source === 'latest')}>${esc(t('logs.src.latest'))}</button>
          ${d.crash ? `<button data-action="setLogSource" data-v="crash" ${pressed(L.source === 'crash')}>${esc(t('logs.src.crash'))}</button>` : ''}
        </div>
        <div class="row" style="gap:6px">
          <div class="seg" role="group" aria-label="${esc(t('logs.filter'))}">
            ${['all', 'warn', 'error'].map((f) => `<button data-action="setLogFilter" data-v="${f}" ${pressed(L.filter === f)}>${esc(t('logs.f.' + f))}</button>`).join('')}
          </div>
          <label for="logq" class="sr">${esc(t('logs.search'))}</label>
          <input id="logq" class="input" type="search" style="width:200px" placeholder="${esc(t('logs.search'))}" value="${esc(L.query)}" data-bind="logs.query" data-log-search>
          <button class="btn sm" data-action="copyLogs">${icon.copy()}<span>${esc(t('launch.copyLog'))}</span></button>
          <button class="icon-btn" style="width:34px;height:34px" data-action="openLogsFolder" aria-label="${esc(t('logs.folder'))}" title="${esc(t('logs.folder'))}">${icon.folder(16)}</button>
        </div>
      </div>
      <pre class="log log-view" id="log-view">${logLinesHtml(text)}</pre>
    </section>`;
}

function logLinesHtml(text) {
  const L = state.logs;
  const q = L.query.trim().toLowerCase();
  const shown = String(text || '').split('\n').map((line) => ({ line, lvl: lineLevel(line) }))
    .filter((x) => (L.filter === 'all' || (L.filter === 'warn' ? x.lvl !== 'info' : x.lvl === 'error')) && (!q || x.line.toLowerCase().includes(q)))
    .slice(-1500);
  return shown.length
    ? shown.map((x) => `<span class="ll ll-${x.lvl}">${esc(x.line)}</span>`).join('\n')
    : `<span class="muted">${esc(t(text ? 'logs.nothing' : 'logs.empty'))}</span>`;
}

const currentLogText = () => {
  const d = state.logs.data || {};
  return state.logs.source === 'crash' ? d.crash : state.logs.source === 'latest' ? d.latest : d.launcher;
};

async function loadLogs(id) {
  state.logs = { ...state.logs, id, data: null, loading: true };
  try { state.logs.data = await api.gameLogs(id); } catch { state.logs.data = { launcher: '', latest: '', crash: '' }; }
  state.logs.loading = false;
  if (state.history.id !== id) loadHistory(id);
  if (state.view === 'instance' && state.instTab === 'logs') render();
}

function profilesBar(e) {
  const pr = state.profiles;
  if (pr.id !== e.id) { state.profiles = { id: e.id, list: null }; api.listProfiles(e.id).then((l) => { state.profiles.list = l; if (state.view === 'instance') render(); }).catch(() => { state.profiles.list = []; }); }
  const list = state.profiles.list || [];
  return `<section class="panel pad-s row" style="gap:10px">
    <span class="row" style="gap:8px;flex-wrap:nowrap">${icon.layers()}<b>${esc(t('prof.title'))}</b></span>
    ${list.length ? list.map((p) => `<span class="row" style="gap:2px;flex-wrap:nowrap"><button class="pill sm" data-action="applyProfile" data-name="${esc(p.name)}" title="${esc(t('prof.apply'))}">${esc(p.name)}</button>
      <button class="icon-btn" style="width:26px;height:26px;box-shadow:none;background:transparent" data-action="deleteProfile" data-name="${esc(p.name)}" aria-label="${esc(t('prof.delete', { name: p.name }))}">${icon.close()}</button></span>`).join('')
      : `<span class="small muted">${esc(t('prof.none'))}</span>`}
    <span class="grow" style="flex:1 1 20px"></span>
    <button class="btn sm" data-action="saveProfile">${esc(t('prof.save'))}</button>
  </section>`;
}

// ---------- Машина времени ----------

function instTime(e) {
  const sn = state.snaps;
  if (sn.id !== e.id || sn.list === null) {
    if (!sn.loading) { state.snaps = { id: e.id, list: null, loading: true }; api.listSnapshots(e.id).then((l) => { state.snaps.list = l; state.snaps.loading = false; render(); }).catch(() => { state.snaps.list = []; }); }
    return `<div class="row" style="padding:20px"><span class="spinner"></span></div>`;
  }
  const date = (sec) => new Date(sec * 1000).toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `
    <section class="panel pad row between" style="gap:14px">
      <div class="stack" style="gap:4px;flex:1 1 320px"><h2 class="h2">${esc(t('tm.title'))}</h2><p class="note">${esc(t('tm.sub'))}</p></div>
      <button class="btn accent" data-action="makeSnapshot" ${sn.busy ? 'disabled' : ''}>${sn.busy ? '<span class="spinner"></span>' : icon.camera()}<span>${esc(t('tm.make'))}</span></button>
    </section>
    ${sn.list.length ? `<section class="panel list">${sn.list.map((x) => `<div class="list-row">
        <span class="thumb mod-icon" style="width:40px;height:40px" aria-hidden="true">${icon.camera(18)}</span>
        <div class="stack grow" style="gap:2px"><b>${esc(x.label || t('tm.noLabel'))}</b>
          <span class="small muted">${esc(date(x.time))} · ${esc(t('unit.mb', { n: (x.size / 1048576).toFixed(1) }))}${x.auto ? ' · ' + esc(t('tm.auto')) : ''}</span></div>
        <button class="btn sm" data-action="askRestoreSnap" data-file="${esc(x.file)}" ${sn.busy ? 'disabled' : ''}>${icon.restore()}<span>${esc(t('tm.restore'))}</span></button>
        <button class="icon-btn" data-action="deleteSnap" data-file="${esc(x.file)}" aria-label="${esc(t('common.delete'))}">${icon.trash()}</button>
      </div>`).join('')}</section>`
      : `<section class="panel empty">${icon.camera(32)}<p class="note" style="max-width:460px">${esc(t('tm.empty'))}</p></section>`}`;
}

async function loadHistory(id) {
  state.history = { id, list: null, loading: true };
  try { state.history.list = await api.modHistory(id); } catch { state.history.list = []; }
  state.history.loading = false;
  if (state.view === 'instance' || state.view === 'home') render();
}

async function loadDeps(id) {
  state.deps = { id, list: null };
  try { state.deps.list = await api.checkDependencies(id); } catch { state.deps.list = []; }
  if ((state.view === 'instance' && state.instTab === 'mods' && state.deps.list.length) || state.view === 'home') render();
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

function memAdviceHtml(e) {
  const m = state.memAdvice?.id === e.id ? state.memAdvice : null;
  if (!m || m.loading) {
    return `<button class="btn" style="align-self:flex-start" data-action="adviseMemory" ${m?.loading ? 'disabled' : ''}>${m?.loading ? `<span class="spinner"></span>` : icon.sparkle(14)}<span>${esc(t('mem.advise'))}</span></button>`;
  }
  const a = m.data;
  const why = [];
  why.push(e.loader === 'vanilla' ? t('mem.whyVanilla') : t('mem.whyMods', { n: a.mods }));
  if (a.shaders) why.push(t('mem.whyShaders'));
  const same = Number(e.memoryGb) === a.recommended;
  return `<div class="mem-advice">
    <div class="stack" style="gap:4px">
      <b>${esc(t('mem.result', { n: a.recommended }))}</b>
      <span class="small">${esc(why.join(' · '))}</span>
      <span class="small muted">${esc(a.systemGb ? t('mem.system', { total: a.systemGb, cap: a.cap }) : t('mem.systemUnknown'))}</span>
      ${a.limited ? `<span class="small" style="color:var(--warn-text)">${esc(t('mem.limited'))}</span>` : ''}
    </div>
    ${same ? `<span class="badge">${esc(t('mem.already'))}</span>` : `<button class="btn accent" data-action="applyMemory" data-n="${a.recommended}">${esc(t('mem.apply', { n: a.recommended }))}</button>`}
  </div>`;
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
      ${memAdviceHtml(e)}
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
  if (r.kind !== 'modpack' && r.kind !== 'datapack' && r.installed.has(m.id)) {
    return `<span class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" disabled>${esc(t('res.installed'))}</button>
      <button class="icon-btn" style="width:34px;height:34px" data-action="uninstall" data-pid="${esc(m.id)}" data-title="${esc(m.title)}" aria-label="${esc(t('res.uninstall', { name: m.title }))}" title="${esc(t('res.uninstall', { name: m.title }))}">${icon.trash()}</button></span>`;
  }
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
    results = `<div class="grid res-grid">
      ${r.results.map((m) => {
        const cats = (m.categories || []).filter((c) => (CATEGORIES[r.kind] || []).includes(c)).slice(0, 3);
        return `<article class="panel result clickable" data-action="openProject" data-pid="${esc(m.id)}" tabindex="0">
        <div class="res-head">
          ${m.icon ? `<img class="thumb" src="${esc(m.icon)}" alt="" loading="lazy">` : `<span class="thumb" style="background:${TINTS[5]}"></span>`}
          <div class="stack" style="gap:3px;min-width:0;flex:1">
            <h2 class="h2 ellipsis" style="font-size:calc(15px*var(--fs,1))">${esc(m.title)}</h2>
            <span class="small muted ellipsis">${esc(t('res.by', { author: m.author }))} · ${esc(t('res.downloads', { n: new Intl.NumberFormat(document.documentElement.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(m.downloads) }))}</span>
          </div>
          ${installButton(m)}
        </div>
        <p class="note res-desc">${esc(m.description)}</p>
        ${cats.length ? `<span class="row" style="gap:4px">${cats.map((c) => `<span class="badge">${esc(t('cat.' + c))}</span>`).join('')}</span>` : ''}
      </article>`;
      }).join('')}
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
      ${r.source === 'modrinth' && CATEGORIES[r.kind] ? `<div class="row" style="gap:6px" role="group" aria-label="${esc(t('res.categories'))}">
        ${CATEGORIES[r.kind].map((c) => `<button class="pill sm" data-action="toggleCat" data-cat="${c}" ${pressed(r.cats.includes(c))}>${esc(t('cat.' + c))}</button>`).join('')}
        ${r.cats.length ? `<button class="pill sm" data-action="clearCats">${esc(t('res.clearCats'))}</button>` : ''}
      </div>` : ''}
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
  const isMs = acc?.kind === 'microsoft' || acc?.kind === 'prism';

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
          ${faceHtml(a, 40)}
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
    ${achievementsHtml()}
    ${(() => { if (state.week === null) { state.week = 'loading'; api.statsSessions().then((l) => { state.week = l; if (state.view === 'accounts') render(); }).catch(() => { state.week = []; }); } return statsHtml(); })()}
    <h2 class="h2" style="margin:8px 0 0 4px">${esc(t('acc.add'))}</h2>
    <div class="grid grid-2">
      <section class="panel pad stack">
        <span class="avatar" style="width:28px;height:28px;border-radius:6px;font-size:calc(14px*var(--fs,1));background:#207E5C">E</span>
        <h3 class="h2">${esc(t('acc.ely'))}</h3>
        <p class="note">${esc(t('acc.elyText'))}</p>
        <button class="btn accent" style="align-self:flex-start" data-action="openEly">${esc(t('acc.elyBtn'))}</button>
      </section>
      <section class="panel pad stack">
        <span class="avatar" style="width:28px;height:28px;border-radius:6px;background:var(--accent-soft);color:var(--accent-text)">${icon.move(16)}</span>
        <h3 class="h2">${esc(t('acc.prism'))}</h3>
        <p class="note">${esc(t('acc.prismText'))}</p>
        <button class="btn accent" style="align-self:flex-start" data-action="openPrismAccounts">${esc(t('acc.prismBtn'))}</button>
      </section>
      ${state.msReady ? `<section class="panel pad stack">
        ${icon.microsoft()}
        <h3 class="h2">${esc(t('acc.ms'))}</h3>
        <p class="note">${esc(t(state.msBusy ? 'acc.msWaiting' : 'acc.msText'))}</p>
        <button class="btn accent" style="align-self:flex-start" data-action="msLogin" ${state.msBusy ? 'disabled' : ''}>${state.msBusy ? '<span class="spinner"></span>' : ''}${esc(t('acc.msBtn'))}</button>
      </section>` : ''}
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
      <span class="theme-preview" style="border:1px solid ${T.border};background:radial-gradient(120px 60px at 90% 0%,${T.g1},transparent 70%),${T.bg2 ? `linear-gradient(160deg,${T.bg},${T.bg2})` : T.bg}">
        <span class="side" style="background:${T.surface};border-right:1px solid ${T.border}"></span>
        <span class="main"><span class="hero-mini" style="background:${T.surface2}"></span><span class="btn-mini" style="background:${T.accent2 ? `linear-gradient(90deg,${T.accent},${T.accent2})` : T.accent}"></span></span>
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
          <button class="btn sm" data-action="surpriseTheme">${icon.dice()}<span>${esc(t('dream.button'))}</span></button>
          <button class="btn sm soft" data-action="newTheme">${icon.sparkle()}<span>${esc(t('te.create'))}</span></button>
        </div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))" role="group" aria-label="${esc(t('set.theme'))}">
        ${[...THEME_ORDER, ...(s.achievements?.legend ? ['netherite'] : [])].map((id) => card(id, THEMES[id], t('theme.' + id))).join('')}
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
          <button class="btn sm soft" data-action="pickBackground">${icon.image(16)}<span>${esc(t('look.bgPickVideo'))}</span></button>
          ${bg.path ? `<button class="btn sm" data-action="clearBackground">${esc(t('cover.remove'))}</button>` : ''}
        </div>
      </div>
      ${bgUrl ? `${/\.(mp4|webm)$/i.test(bg.path) ? `<video class="bg-preview" src="${esc(bgUrl)}" autoplay muted loop playsinline style="object-fit:cover"></video>` : `<div class="bg-preview" style="background-image:url('${esc(bgUrl)}')"></div>`}
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
      <div class="grid grid-2">
        <div class="stack" style="gap:8px">
          <span class="label">${esc(t('te.depth'))}</span>
          <div class="seg" role="group" aria-label="${esc(t('te.depth'))}" style="align-self:flex-start">
            ${[0, 1, 2].map((v) => `<button data-action="setDepth" data-v="${v}" ${pressed(Number(s.depth ?? 1) === v)}>${esc(t('te.depth.' + v))}</button>`).join('')}
          </div>
        </div>
        <div class="stack" style="gap:8px">
          <span class="label">${esc(t('te.pattern'))}</span>
          <div class="seg" role="group" aria-label="${esc(t('te.pattern'))}" style="align-self:flex-start;flex-wrap:wrap">
            ${[['', 'none'], ['dots', 'dots'], ['grid', 'grid'], ['pixels', 'pixels'], ['stars', 'stars']].map(([v, k]) => `<button data-action="setPattern" data-v="${v}" ${pressed((s.pattern || '') === v)}>${esc(t('te.pat.' + k))}</button>`).join('')}
          </div>
        </div>
        ${rangeRow({ id: 'glowlvl', key: 'glow', label: t('te.glow'), min: 0, max: 100, step: 5, value: s.glow ?? 50, unit: '%' })}
      </div>
      <p class="note">${esc(t('look.ownThemeNote'))}</p>
      <div class="row"><button class="btn sm" data-action="resetLook">${esc(t('look.reset'))}</button></div>
      ${switchRow('toggleOn', 'jelly', s.jelly !== false, t('look.jelly'), t('look.jellySub'))}
      ${switchRow('toggleOn', 'pet', s.pet !== false, t('look.pet'), t('look.petSub'))}
      ${switchRow('toggleSetting', 'aquarium', !!s.aquarium, t('look.aquarium'), t('look.aquariumSub'))}
      ${switchRow('toggleOn', 'clock', s.clock !== false, t('look.clock'))}
      ${switchRow('toggleOn', 'portal', s.portal !== false, t('look.portal'), t('look.portalSub'))}
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
    </section>
    <section class="panel pad stack" style="gap:8px">
      <h2 class="h2">${esc(t('music.title'))}</h2>
      ${rangeRow({ id: 'musvol', key: 'musicVolume', label: t('music.volume'), min: 5, max: 100, step: 5, value: s.musicVolume ?? 70, unit: '%' })}
    </section>
    <section class="panel pad stack" style="gap:6px">
      <h2 class="h2">Discord</h2>
      ${switchRow('toggleOn', 'discord', s.discord !== false, t('dc.show'), t('dc.showSub'))}
      ${s.discord !== false ? switchRow('toggleSetting', 'discordHideName', s.discordHideName, t('dc.hideName'), t('dc.hideNameSub')) : ''}
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

    <section class="panel pad stack" style="gap:10px">
      <div class="stack" style="gap:2px"><h2 class="h2">${esc(t('set.speed'))}</h2><span class="note">${esc(t('set.speedSub'))}</span></div>
      <div class="speed-pick" role="radiogroup" aria-label="${esc(t('set.speed'))}">
        ${['normal', 'fast', 'turbo'].map((m, i) => `<button role="radio" aria-checked="${(s.downloadSpeed || 'normal') === m}" data-action="setSpeed" data-v="${m}">
          <span class="speed-bars" aria-hidden="true">${[0, 1, 2].map((b) => `<i class="${b <= i ? 'on' : ''}"></i>`).join('')}</span>
          <b>${esc(t('set.speed.' + m))}</b><span class="small muted">${esc(t('set.speed.' + m + 'Sub'))}</span></button>`).join('')}
      </div>
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
        <div class="row between" style="gap:12px;padding-top:6px">
          <span class="stack" style="gap:2px"><span>${esc(t('tour.again'))}</span><span class="small muted">${esc(t('tour.againSub'))}</span></span>
          <button class="btn" data-action="startTour">${esc(t('tour.againBtn'))}</button>
        </div>
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
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('bug.title'))}</h2>
        <p class="note">${esc(t('bug.settingsNote'))}</p>
        <button class="btn" style="align-self:flex-start" data-action="openBugReport">${esc(t('bug.button'))}</button>
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

// ---------- Новости ----------

async function loadNews() {
  state.news.error = false;
  try { state.news.list = await api.minecraftNews(); } catch { state.news.list = []; state.news.error = true; }
  if (state.view === 'news') render();
}

async function loadTrend() {
  try { state.news.trend = await trending('mod'); } catch { state.news.trend = { spotlight: null, rising: [], updated: [] }; }
  if (state.view === 'news') render();
}

function miniProject(m) {
  return `<button class="card news-proj" data-action="openProject" data-pid="${esc(m.id)}" data-kind="mod">
    ${m.icon ? `<img class="thumb" src="${esc(m.icon)}" alt="" loading="lazy">` : `<span class="thumb" style="background:${TINTS[5]}"></span>`}
    <span class="stack" style="gap:2px;min-width:0"><span class="card-title ellipsis" style="font-size:calc(14px*var(--fs,1))">${esc(m.title)}</span>
      <span class="small muted ellipsis">${esc(m.description)}</span></span>
  </button>`;
}

function viewNews() {
  const n = state.news;
  if (n.list === null && !n.loading) { n.loading = true; loadNews().finally(() => { n.loading = false; }); }
  if (n.trend === null && !n.trendLoading) { n.trendLoading = true; loadTrend(); }
  const tabs = ['all', 'minecraft', 'updates', 'mods'].map((k) => `<button role="tab" aria-selected="${n.tab === k}" data-action="setNewsTab" data-tab="${k}">${esc(t('news.tab.' + k))}</button>`).join('');
  const tr = n.trend;
  const spotlight = tr?.spotlight ? `<section class="panel spotlight" data-action="openProject" data-pid="${esc(tr.spotlight.id)}" data-kind="mod" tabindex="0">
      ${tr.spotlight.icon ? `<img src="${esc(tr.spotlight.icon)}" alt="" class="spot-icon">` : ''}
      <div class="stack" style="gap:6px;min-width:0">
        <span class="eyebrow" style="color:var(--accent-text)">${icon.star(14)} ${esc(t('news.spotlight'))}</span>
        <h2 class="h2-lg">${esc(tr.spotlight.title)}</h2>
        <p class="note">${esc(tr.spotlight.description)}</p>
        <span class="small muted">${esc(t('res.downloads', { n: formatNumber(tr.spotlight.downloads) }))} · ${esc(t('news.spotlightWhy'))}</span>
      </div>
    </section>` : '';
  const modsBlock = tr ? `${spotlight}
      ${tr.rising.length ? `<h2 class="h2" style="margin:4px 0 0 4px">${esc(t('news.rising'))}</h2><div class="grid news-grid">${tr.rising.map(miniProject).join('')}</div>` : ''}
      ${tr.updated.length ? `<h2 class="h2" style="margin:4px 0 0 4px">${esc(t('news.updated'))}</h2><div class="grid news-grid">${tr.updated.map(miniProject).join('')}</div>` : ''}
      ${!tr.spotlight && !tr.rising.length && !tr.updated.length ? `<section class="panel empty"><span class="muted">${esc(t('res.error', { source: 'Modrinth' }))}</span></section>` : ''}`
    : `<div class="row" style="padding:20px"><span class="spinner"></span></div>`;

  const items = (n.list || []).filter((x) => n.tab === 'all' || (n.tab === 'minecraft' ? x.kind === 'news' : n.tab === 'updates' ? x.kind !== 'news' : false));
  const article = (x) => `<article class="panel news-card" ${x.url || x.contentPath ? `data-action="openNews" data-id="${esc(x.id)}" tabindex="0"` : ''}>
      ${x.image ? `<img class="news-img" src="${esc(x.image)}" alt="" loading="lazy">` : `<span class="news-img" style="background:${TINTS[x.kind === 'news' ? 1 : x.kind === 'snapshot' ? 4 : 2]}"></span>`}
      <div class="stack" style="gap:6px;padding:14px">
        <span class="row" style="gap:6px"><span class="badge">${esc(t('news.kind.' + x.kind))}</span><span class="small muted">${esc(x.date ? new Date(x.date).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long', year: 'numeric' }) : '')}</span></span>
        <h2 class="h2">${esc(x.title)}</h2>
        ${x.text ? `<p class="note">${esc(x.text)}</p>` : ''}
      </div>
    </article>`;
  let body;
  if (n.tab === 'mods') body = modsBlock;
  else if (n.list === null) body = `<div class="row" style="padding:20px"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  else if (n.error && !n.list.length) body = `<section class="panel empty"><span class="warn">${esc(t('news.error'))}</span><button class="btn sm" data-action="reloadNews">${esc(t('create.retry'))}</button></section>`;
  else body = (n.tab === 'all' && tr?.spotlight ? spotlight : '') + `<div class="news-list">${items.map(article).join('')}</div>`;

  // «Обновились в ваших сборках» — напоминание, что можно проверить обновления
  return `<div class="view">
    <h1 class="page-title">${esc(t('news.title'))}</h1>
    <div class="tabs" role="tablist">${tabs}</div>
    ${n.tab === 'mods' || n.tab === 'all' ? `<section class="panel pad-s row between" style="gap:12px">
      <span class="note" style="flex:1 1 300px">${esc(t('news.myMods'))}</span>
      <button class="btn sm soft" data-action="checkAllUpdates" ${state.allUpdates?.busy ? 'disabled' : ''}>${state.allUpdates?.busy ? '<span class="spinner"></span>' : ''}${esc(t('news.checkMine'))}</button>
    </section>${state.allUpdates?.list ? allUpdatesHtml() : ''}` : ''}
    ${body}
  </div>`;
}

function allUpdatesHtml() {
  const list = state.allUpdates.list;
  if (!list.length) return `<p class="note" style="margin-left:4px">${esc(t('news.allFresh'))}</p>`;
  return `<section class="panel list">${list.map((g) => `<div class="list-row">
      <span class="thumb" style="width:36px;height:36px;${coverBg(state.instances.find((i) => i.id === g.id))}"></span>
      <div class="stack grow" style="gap:2px"><b>${esc(g.name)}</b>
        <span class="small muted">${g.updates.slice(0, 6).map((u) => `${esc(u.name)} ${esc(u.current)} → ${esc(u.latest)}`).join(' · ')}${g.updates.length > 6 ? ' …' : ''}</span></div>
      <button class="btn sm" data-action="openInstance" data-id="${esc(g.id)}" data-tab="mods">${esc(t('news.openMods'))}</button>
    </div>`).join('')}</section>`;
}

// ---------- Музыка ----------

const MUSIC_GROUPS = ['menu', 'game', 'creative', 'water', 'nether', 'end', 'records', 'other'];

async function loadMusic() {
  try { state.music.list = await api.listMusic(); } catch { state.music.list = []; }
  if (state.view === 'music') render();
}

const fmtTime = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
const favs = () => new Set(state.settings.musicFav || []);

function viewMusic() {
  const mu = state.music;
  if (mu.list === null && !mu.loading) { mu.loading = true; loadMusic().finally(() => { mu.loading = false; }); }
  if (mu.list === null) return `<div class="view"><h1 class="page-title">${esc(t('music.title'))}</h1><div class="row" style="padding:20px"><span class="spinner"></span></div></div>`;
  const fav = favs();
  const groups = MUSIC_GROUPS.filter((g) => mu.list.some((x) => x.group === g));
  const list = musicQueue();
  const cur = mu.current;
  const repeat = state.settings.musicRepeat || 'all';
  const vol = state.settings.musicVolume ?? 70;
  const sleep = mu.sleep;
  const empty = `<section class="panel empty">${icon.music(32)}<h2 class="h2">${esc(t('music.empty'))}</h2><p class="note" style="max-width:480px">${esc(t('music.emptySub'))}</p></section>`;
  if (!mu.list.length) return `<div class="view"><h1 class="page-title">${esc(t('music.title'))}</h1>${empty}</div>`;
  const dur = audio.duration || 0;
  const pos = audio.currentTime || 0;
  const pct = dur ? (pos / dur) * 100 : 0;
  return `<div class="view">
    <section class="panel bigplayer" aria-label="${esc(t('music.player'))}">
      <span class="disc ${mu.playing ? 'spin' : ''}" aria-hidden="true"><svg viewBox="0 0 16 16" width="120" height="120" shape-rendering="crispEdges"><rect x="3" y="1" width="10" height="14" fill="#1C1C1C"/><rect x="1" y="3" width="14" height="10" fill="#1C1C1C"/><rect x="2" y="2" width="12" height="12" fill="#1C1C1C"/><rect x="4" y="4" width="8" height="8" fill="#262626"/><rect x="6" y="6" width="4" height="4" fill="var(--accent)"/><rect x="7" y="7" width="2" height="2" fill="#0A0A0A"/><rect x="3" y="3" width="2" height="1" fill="#3A3A3A"/></svg></span>
      <div class="stack" style="flex:1 1 380px;min-width:0;gap:12px">
        <div class="stack" style="gap:4px">
          <span class="eyebrow-mono">${esc(cur ? t('music.now') + ' · ' + t('music.g.' + cur.group) : t('music.pick'))}</span>
          <h1 style="margin:0;font-size:calc(30px*var(--fs,1));font-weight:700" class="ellipsis">${esc(cur ? cur.title : t('music.title'))}</h1>
        </div>
        <div class="row" style="gap:12px;flex-wrap:nowrap">
          <span class="mono small muted" id="mu-pos">${fmtTime(pos)}</span>
          <label for="mu-seek" class="sr">${esc(t('music.seek'))}</label>
          <input id="mu-seek" type="range" class="range-line" min="0" max="1000" step="1" value="${Math.round(pct * 10)}" style="--p:${pct}%" ${cur ? '' : 'disabled'} data-seek>
          <span class="mono small muted" id="mu-dur">${fmtTime(dur)}</span>
        </div>
        <div class="row" style="gap:10px">
          <button class="icon-btn" data-action="toggleShuffle" ${pressed(mu.shuffle)} aria-label="${esc(t('music.shuffle'))}" title="${esc(t('music.shuffle'))}" style="${mu.shuffle ? 'color:var(--accent-text);box-shadow:var(--raise),0 0 0 1px var(--accent)' : ''}">${icon.shuffle()}</button>
          <button class="icon-btn" data-action="musicPrev" aria-label="${esc(t('music.prev'))}">${icon.prev()}</button>
          <button class="play" style="min-width:0;width:56px;height:56px;padding:0" data-action="${cur ? 'musicToggle' : 'playAll'}" aria-label="${esc(t(mu.playing ? 'music.pause' : 'music.play'))}">${mu.playing ? icon.pause(20) : icon.play(20)}</button>
          <button class="icon-btn" data-action="musicNext" aria-label="${esc(t('music.next'))}">${icon.next()}</button>
          <div class="seg" role="group" aria-label="${esc(t('music.repeat'))}">
            ${['off', 'all', 'one'].map((r) => `<button data-action="setRepeat" data-v="${r}" ${pressed(repeat === r)}>${esc(t('music.repeat.' + r))}</button>`).join('')}
          </div>
          <span class="grow" style="flex:1 1 20px"></span>
          <span class="row" style="gap:8px;flex-wrap:nowrap;color:var(--muted)">${icon.volume()}
            <label for="mu-vol" class="sr">${esc(t('music.volume'))}</label>
            <input id="mu-vol" type="range" class="range-line" style="width:110px;flex:none;--p:${vol}%" min="0" max="100" step="1" value="${vol}" data-bind="settings.musicVolume" data-number data-save-settings data-vol></span>
        </div>
        <div class="row" style="gap:8px">
          <span class="small muted">${icon.moonSleep(14)} ${esc(t('music.sleep'))}:</span>
          ${[0, 15, 30, 60, -1].map((m) => `<button class="pill sm" data-action="setSleep" data-m="${m}" ${pressed((sleep?.mode ?? 0) === m)}>${esc(m === 0 ? t('music.sleepOff') : m === -1 ? t('music.sleepTrack') : t('music.sleepMin', { n: m }))}</button>`).join('')}
          ${sleep && sleep.until ? `<span class="small muted" id="mu-sleep">${esc(t('music.sleepLeft', { t: fmtTime((sleep.until - Date.now()) / 1000) }))}</span>` : ''}
        </div>
      </div>
    </section>

    <div class="row between">
      <div class="row" style="gap:6px" role="group" aria-label="${esc(t('music.groups'))}">
        <button class="pill" data-action="setMusicGroup" data-g="all" ${pressed(mu.group === 'all')}>${esc(t('music.all'))}</button>
        <button class="pill" data-action="setMusicGroup" data-g="fav" ${pressed(mu.group === 'fav')}>${icon.heart(14)} ${esc(t('music.fav'))}${fav.size ? ' · ' + fav.size : ''}</button>
        ${groups.map((g) => `<button class="pill" data-action="setMusicGroup" data-g="${g}" ${pressed(mu.group === g)}>${esc(t('music.g.' + g))}</button>`).join('')}
      </div>
      <button class="switch-row" style="width:auto;gap:10px" role="switch" aria-checked="${!!state.settings.menuMusic}" data-action="toggleMenuMusic" title="${esc(t('music.menuSub'))}"><span class="small">${esc(t('music.menu'))}</span><span class="switch"></span></button>
    </div>
    ${mu.group === 'fav' && !list.length ? `<p class="note" style="margin-left:4px">${esc(t('music.favEmpty'))}</p>` : ''}
    <section class="panel list">${list.map((x, n) => {
      const on = cur?.key === x.key;
      return `<div class="list-row track-row ${on ? 'on' : ''}">
        <button class="track" data-action="playTrack" data-key="${esc(x.key)}" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;padding:0">
          <span class="thumb mod-icon mono" style="width:36px;height:36px;font-size:calc(12px*var(--fs,1));${on ? 'background:var(--accent-fill);color:var(--accent-ink)' : ''}" aria-hidden="true">${on && mu.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : String(n + 1).padStart(2, '0')}</span>
          <span class="grow card-title ellipsis" style="font-size:calc(14px*var(--fs,1));text-align:left">${esc(x.title)}</span>
          <span class="small muted" style="width:120px;text-align:left">${esc(t('music.g.' + x.group))}</span>
        </button>
        <button class="heart" data-action="toggleFav" data-key="${esc(x.key)}" ${pressed(fav.has(x.key))} aria-label="${esc(t(fav.has(x.key) ? 'music.unfav' : 'music.favAdd', { name: x.title }))}">${icon.heart()}</button>
      </div>`;
    }).join('')}</section>
  </div>`;
}

/** Обновляет только ползунок и время, не перерисовывая весь экран */
function refreshSeek() {
  if (state.view !== 'music') return;
  const seek = $('#mu-seek');
  if (!seek || seek.matches(':active')) return;
  const dur = audio.duration || 0;
  const pct = dur ? (audio.currentTime / dur) * 100 : 0;
  seek.value = String(Math.round(pct * 10));
  seek.style.setProperty('--p', pct + '%');
  const p = $('#mu-pos'); if (p) p.textContent = fmtTime(audio.currentTime);
  const d = $('#mu-dur'); if (d) d.textContent = fmtTime(dur);
  const sl = $('#mu-sleep');
  if (sl && state.music.sleep?.until) sl.textContent = t('music.sleepLeft', { t: fmtTime((state.music.sleep.until - Date.now()) / 1000) });
}

/** Маленький плеер внизу меню: виден на любом экране, пока играет музыка */
function playerHtml() {
  const mu = state.music;
  if (!mu.current) return '';
  return `<div class="player">
    <div class="stack" style="gap:2px;min-width:0"><span class="small muted">${esc(t('music.now'))}</span><b class="ellipsis">${esc(mu.current.title)}</b></div>
    <div class="row" style="gap:4px;flex-wrap:nowrap">
      <button class="icon-btn" style="width:32px;height:32px" data-action="musicToggle" aria-label="${esc(t(mu.playing ? 'music.pause' : 'music.play'))}">${mu.playing ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>' : icon.play(14)}</button>
      <button class="icon-btn" style="width:32px;height:32px" data-action="musicNext" aria-label="${esc(t('music.next'))}">${icon.chevronRight(14)}</button>
      <button class="icon-btn" style="width:32px;height:32px" data-action="musicStop" aria-label="${esc(t('music.stop'))}">${icon.close()}</button>
    </div>
  </div>`;
}

const VIEWS = { home: viewHome, instances: viewInstances, create: viewCreate, instance: viewInstance, resources: viewResources, wiki: viewWiki, news: viewNews, music: viewMusic, skins: viewSkins, book: viewBook, accounts: viewAccounts, settings: viewSettings };

// ---------- Отрисовка ----------

function renderChrome() {
  const titleRight = `<div class="winbtns">
      <button class="winbtn" data-action="toggleMini" aria-label="${esc(t(state.mini ? 'mini.exit' : 'mini.enter'))}" title="${esc(t(state.mini ? 'mini.exit' : 'mini.enter'))}">${state.mini ? icon.maximize() : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="5.5" y="5.5" width="5" height="5" rx="1" fill="none" stroke="currentColor"/><path d="M1.5 6V2.5a1 1 0 0 1 1-1H9" fill="none" stroke="currentColor"/></svg>'}</button>
      <button class="winbtn" data-action="winMin" aria-label="${esc(t('win.minimize'))}">${icon.minimize()}</button>
      <button class="winbtn" data-action="winMax" aria-label="${esc(t('win.maximize'))}">${icon.maximize()}</button>
      <button class="winbtn close" data-action="winClose" aria-label="${esc(t('win.close'))}">${icon.close()}</button>
    </div>`;
  const showList = LIST_VIEWS.has(state.view);
  $('#titlebar').innerHTML = `
    <button class="searchbox" data-action="openPalette" aria-label="${esc(t('pal.open'))}">${icon.search(14)}<span>${esc(t('pal.search'))}</span><kbd>Ctrl K</kbd></button>
    <div class="grow" data-tauri-drag-region style="align-self:stretch"></div>
    ${!showList && state.music.current ? `<div class="title-player">${playerHtml()}</div>` : ''}
    ${dlButtonHtml()}
    ${state.settings.clock !== false ? `<span class="clock" id="clock" aria-label="${esc(t('clock.label'))}">${clockText()}</span>` : ''}
    ${titleRight}`;

  const active = NAV_OF_VIEW[state.view];
  const btn = (n) => `<button class="rail-btn" data-action="nav" data-view="${n.view}" data-tip="${esc(t('nav.' + n.id))}" aria-label="${esc(t('nav.' + n.id))}" aria-current="${n.id === active ? 'page' : 'false'}">${icon[n.ic](20)}</button>`;
  const acc = activeAccount();
  $('#rail').setAttribute('aria-label', t('nav.label'));
  $('#rail').innerHTML = `
    <div class="rail-group">
      <span class="rail-logo" aria-hidden="true">${icon.moon(22)}</span>
      ${NAV.filter((n) => n.id !== 'settings').map(btn).join('')}
    </div>
    <div class="rail-group">
      ${btn(NAV.find((n) => n.id === 'settings'))}
      <button class="rail-face" data-action="nav" data-view="accounts" aria-label="${esc(acc ? t('nav.profile', { name: acc.name }) : t('acc.notSigned'))}" title="${esc(acc ? acc.name : t('acc.notSigned'))}">${faceHtml(acc, 36)}</button>
    </div>`;

  const side = $('#sidebar');
  side.hidden = !showList;
  if (showList) {
    const list = visibleInstances();
    const cur = selected();
    side.setAttribute('aria-label', t('inst.title'));
    side.innerHTML = `
      <div class="il-head">
        <span class="eyebrow-mono">${esc(t('inst.title'))} · ${state.instances.length}</span>
        <span class="row" style="gap:6px;flex-wrap:nowrap">
          <button class="icon-btn" style="width:32px;height:32px" data-action="nav" data-view="instances" aria-label="${esc(t('home.allInstances'))}" title="${esc(t('home.allInstances'))}">${icon.box(16)}</button>
          <button class="icon-btn" style="width:32px;height:32px" data-action="openCreate" aria-label="${esc(t('home.newInstance'))}" title="${esc(t('home.newInstance'))}">+</button>
        </span>
      </div>
      <div class="il-list">
        ${list.map((i) => `<button class="il-item" data-action="pickInstance" data-id="${esc(i.id)}" data-ctx="${esc(i.id)}" ${pressed(cur && i.id === cur.id && state.view === 'home')}>
          <span class="il-icon">${instIcon(i)}</span>
          <span class="stack grow" style="gap:3px;min-width:0"><span class="ellipsis" style="font-weight:600">${esc(i.name)}</span><span class="mono small muted">${esc(i.loader === 'vanilla' ? 'vanilla' : i.loader)} ${esc(i.gameVersion)}</span></span>
          ${state.running.has(i.id) ? '<span class="il-running" aria-label="' + esc(t('launch.running')) + '"></span>' : i.favorite ? `<span style="color:#FFD166">${icon.star(14).replace('fill="none"', 'fill="currentColor"')}</span>` : ''}
        </button>`).join('') || `<p class="note" style="padding:8px">${esc(t('inst.empty'))}</p>`}
      </div>
      <div class="il-foot">${playerHtml()}</div>`;
  } else {
    side.innerHTML = '';
  }
  paintSkins(document.getElementById('rail'));
  paintSkins(side);
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

/**
 * Описание мода с Modrinth: это Markdown вперемешку с HTML. Чужой HTML мы никогда
 * не вставляем как есть (это небезопасно) — оставляем только картинки и ссылки,
 * а всё остальное превращаем в обычный текст.
 */
function safeMarkdown(src) {
  let text = String(src || '')
    .replace(/<img[^>]*?src=["']([^"']+)["'][^>]*>/gi, '\n![]($1)\n')
    .replace(/<a[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `[${inner.replace(/<[^>]+>/g, '').trim() || href}](${href})`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|center|details|summary)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  const okUrl = (u) => /^https:\/\//i.test(u);
  const inline = (line) => {
    const parts = [];
    // Сначала вынимаем картинки и ссылки, чтобы экранировать остальное
    line = line.replace(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g, (_, u) => { parts.push(okUrl(u) ? `<img class="md-img" src="${esc(u)}" alt="" loading="lazy">` : ''); return `\u0000${parts.length - 1}\u0000`; });
    line = line.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label, u) => { parts.push(okUrl(u) ? `<a href="#" data-action="openUrl" data-url="${esc(u)}">${esc(label)}</a>` : esc(label)); return `\u0000${parts.length - 1}\u0000`; });
    let html = esc(line)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<i>$2</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    return html.replace(/\u0000(\d+)\u0000/g, (_, n) => parts[Number(n)]);
  };
  let html = '';
  let list = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^[-*+] /.test(line)) {
      if (!list) { html += '<ul>'; list = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (list) { html += '</ul>'; list = false; }
    if (!line || /^[-*_]{3,}$/.test(line)) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) html += `<p class="h2" style="margin-top:6px">${inline(h[2])}</p>`;
    else if (line.startsWith('>')) html += `<p class="note">${inline(line.replace(/^>\s?/, ''))}</p>`;
    else html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? '</ul>' : '');
}

function projectDialog(d) {
  const p = d.data;
  let body;
  if (d.error) body = `<p class="warn">${esc(t('res.error', { source: 'Modrinth' }))}</p>`;
  else if (!p) body = `<div class="row" style="padding:30px;justify-content:center"><span class="spinner"></span></div>`;
  else {
    const date = (iso) => (iso ? new Date(iso).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
    const tab = d.tab || 'about';
    const tabs = ['about', 'gallery', 'versions'].filter((k) => k !== 'gallery' || p.gallery.length)
      .map((k) => `<button role="tab" aria-selected="${tab === k}" data-action="setProjectTab" data-tab="${k}">${esc(t('proj.tab.' + k))}</button>`).join('');
    let inner = '';
    if (tab === 'about') inner = `<div class="md">${safeMarkdown(p.body) || esc(p.description)}</div>`;
    if (tab === 'gallery') inner = `<div class="gallery">${p.gallery.map((g) => `<figure><img src="${esc(g.url)}" alt="" loading="lazy">${g.title ? `<figcaption class="small muted">${esc(g.title)}</figcaption>` : ''}</figure>`).join('')}</div>`;
    if (tab === 'versions') inner = p.versions.length
      ? `<div class="list" style="padding:0">${p.versions.map((v) => `<div class="list-row"><div class="stack grow" style="gap:2px"><b>${esc(v.name)}</b>
          <span class="small muted">${esc((v.loaders || []).join(', '))} · ${esc((v.games || []).slice(-4).join(', '))}</span></div>
          <span class="badge">${esc(t('proj.vt.' + v.type))}</span><span class="small muted">${esc(date(v.date))}</span></div>`).join('')}</div>`
      : `<p class="note">${esc(t('proj.noVersions'))}</p>`;
    const links = Object.entries(p.links).filter(([, u]) => u).map(([k, u]) => `<a href="#" class="small" data-action="openUrl" data-url="${esc(u)}">${esc(t('proj.link.' + k))}</a>`).join(' · ');
    body = `<div class="row" style="gap:14px;flex-wrap:nowrap;align-items:flex-start">
        ${p.icon ? `<img class="thumb" style="width:64px;height:64px;border-radius:14px" src="${esc(p.icon)}" alt="">` : ''}
        <div class="stack" style="gap:4px;min-width:0">
          <h2 id="dlg-title">${esc(p.title)}</h2>
          <span class="note">${esc(p.description)}</span>
          <span class="small muted">${p.authors.length ? esc(t('res.by', { author: p.authors.slice(0, 3).join(', ') })) + ' · ' : ''}${esc(t('res.downloads', { n: formatNumber(p.downloads) }))} · ${esc(t('proj.updated', { date: date(p.updated) }))}${p.license ? ' · ' + esc(p.license) : ''}</span>
          <span class="row" style="gap:4px">${p.categories.filter((c) => Object.values(CATEGORIES).flat().includes(c)).map((c) => `<span class="badge">${esc(t('cat.' + c))}</span>`).join('')}</span>
        </div>
      </div>
      ${p.deps.length ? `<p class="small"><b>${esc(t('proj.deps'))}</b> ${p.deps.map((x) => esc(x.title) + (x.type === 'optional' ? ' (' + esc(t('proj.optional')) + ')' : '')).join(', ')}</p>` : ''}
      <div class="tabs" role="tablist">${tabs}</div>
      <div class="proj-body">${inner}</div>
      <div class="row between">
        <span class="row" style="gap:6px">${links}</span>
        <span class="row" style="gap:8px">
          <button class="btn" data-action="closeDialog">${esc(t('common.close'))}</button>
          ${d.kind === state.res.kind && state.view === 'resources' ? installButton({ id: p.id, title: p.title }) : ''}
        </span>
      </div>`;
  }
  return `<div class="overlay" data-action="closeDialog"><div class="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>${body}</div></div>`;
}

// ---------- Сравнение сборок ----------

function compareDialog(d) {
  const opts = (sel) => state.instances.map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${esc(i.name)} · ${esc(i.gameVersion)}</option>`).join('');
  let body = `<div class="row" style="padding:12px"><span class="spinner"></span></div>`;
  if (d.result) {
    const r = d.result;
    const col = (title, list, cls) => `<div class="stack" style="gap:6px;flex:1 1 200px;min-width:0"><span class="eyebrow-mono">${esc(title)} · ${list.length}</span>
      <div class="cmp-list">${list.map((x) => `<span class="cmp-item ${cls}">${esc(x)}</span>`).join('') || `<span class="small muted">—</span>`}</div></div>`;
    body = `<div class="row" style="align-items:flex-start;gap:14px">
      ${col(t('cmp.onlyA', { name: r.a }), r.onlyA, 'a')}
      ${col(t('cmp.onlyB', { name: r.b }), r.onlyB, 'b')}
      ${col(t('cmp.diff'), r.diff, 'd')}
    </div><p class="small muted">${esc(t('cmp.same', { n: r.same }))}</p>`;
  }
  return `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:860px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
    <h2 id="dlg-title">${esc(t('cmp.title'))}</h2>
    <div class="row" style="gap:10px">
      <label class="sr" for="cmp-a">A</label><select id="cmp-a" class="input" style="flex:1" data-change="cmpA">${opts(d.a)}</select>
      ${icon.compare()}
      <label class="sr" for="cmp-b">B</label><select id="cmp-b" class="input" style="flex:1" data-change="cmpB">${opts(d.b)}</select>
    </div>
    <div style="max-height:52vh;overflow:auto">${body}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn accent" data-action="closeDialog">${esc(t('common.close'))}</button></div>
  </div></div>`;
}

async function runCompare() {
  const d = state.dialog;
  if (d?.type !== 'compare') return;
  d.result = null; renderOverlay();
  const load = async (id) => { try { return await api.listMods(id); } catch { return []; } };
  const [ma, mb] = await Promise.all([load(d.a), load(d.b)]);
  const key = (m) => (m.modId || m.name || m.file).toLowerCase();
  const A = new Map(ma.map((m) => [key(m), m]));
  const B = new Map(mb.map((m) => [key(m), m]));
  const nameOf = (id) => state.instances.find((i) => i.id === id)?.name || '';
  const res = { a: nameOf(d.a), b: nameOf(d.b), onlyA: [], onlyB: [], diff: [], same: 0 };
  for (const [k, m] of A) {
    const o = B.get(k);
    if (!o) res.onlyA.push(m.name);
    else if ((m.version || '') !== (o.version || '')) res.diff.push(`${m.name}: ${m.version || '?'} / ${o.version || '?'}`);
    else res.same++;
  }
  for (const [k, m] of B) if (!A.has(k)) res.onlyB.push(m.name);
  if (state.dialog === d) { d.result = res; renderOverlay(); }
}

// ---------- Статистика ----------

function statsHtml() {
  const list = Array.isArray(state.week) ? state.week : [];
  if (!list.length) return `<section class="panel pad stack"><h2 class="h2">${esc(t('stats.title'))}</h2><p class="note">${esc(t('stats.empty'))}</p></section>`;
  const total = list.reduce((a, x) => a + x.seconds, 0);
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return { y: d.getFullYear(), m: d.getMonth(), secs: 0 }; });
  for (const x of list) { const d = new Date(x.start * 1000); const mm = months.find((m) => m.y === d.getFullYear() && m.m === d.getMonth()); if (mm) mm.secs += x.seconds; }
  const maxM = Math.max(...months.map((m) => m.secs), 1);
  const byInst = {};
  for (const x of list) byInst[x.name || x.instance] = (byInst[x.name || x.instance] || 0) + x.seconds;
  const top = Object.entries(byInst).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxI = top[0]?.[1] || 1;
  const lang = document.documentElement.lang;
  const longest = list.reduce((a, x) => Math.max(a, x.seconds), 0);
  return `<section class="panel pad stack" style="gap:16px">
    <div class="row between"><h2 class="h2">${esc(t('stats.title'))}</h2><span class="mono small muted">${esc(t('stats.local'))}</span></div>
    <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="panel stat" style="background:var(--card2)"><span class="eyebrow-mono" style="font-size:calc(10px*var(--fs,1))">${esc(t('stats.total'))}</span><b>${esc(formatPlayTime(total))}</b></div>
      <div class="panel stat" style="background:var(--card2)"><span class="eyebrow-mono" style="font-size:calc(10px*var(--fs,1))">${esc(t('stats.sessions'))}</span><b>${list.length}</b></div>
      <div class="panel stat" style="background:var(--card2)"><span class="eyebrow-mono" style="font-size:calc(10px*var(--fs,1))">${esc(t('stats.avg'))}</span><b>${esc(formatPlayTime(Math.round(total / list.length)))}</b></div>
      <div class="panel stat" style="background:var(--card2)"><span class="eyebrow-mono" style="font-size:calc(10px*var(--fs,1))">${esc(t('stats.longest'))}</span><b>${esc(formatPlayTime(longest))}</b></div>
    </div>
    <div class="stack" style="gap:8px"><span class="eyebrow-mono">${esc(t('stats.byMonth'))}</span>
      <div class="week" style="grid-template-columns:repeat(12,1fr);height:140px">${months.map((m) => `<div class="week-col" title="${esc(formatPlayTime(m.secs))}"><span class="week-bar" style="height:${Math.max(m.secs ? 6 : 2, Math.round((m.secs / maxM) * 100))}%"></span><span class="small muted">${esc(new Date(m.y, m.m, 1).toLocaleDateString(lang, { month: 'short' }))}</span></div>`).join('')}</div></div>
    <div class="stack" style="gap:8px"><span class="eyebrow-mono">${esc(t('stats.byInstance'))}</span>
      ${top.map(([name, secs]) => `<div class="hbar"><span class="ellipsis" style="width:180px">${esc(name)}</span><span class="hbar-track"><span style="width:${Math.round((secs / maxI) * 100)}%"></span></span><span class="mono small muted" style="width:90px;text-align:right">${esc(formatPlayTime(secs))}</span></div>`).join('')}</div>
  </section>`;
}

// ---------- Созвездие сборок ----------

function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

function constellationHtml(list) {
  const W = 1000, H = 520;
  const pts = list.map((i) => ({ i, x: 60 + hash01(i.id, 1) * (W - 120), y: 50 + hash01(i.id, 7) * (H - 100), r: 3 + Math.min(9, Math.sqrt((i.playTimeSecs || 0) / 3600) * 1.6) }));
  // Раздвигаем звёзды, которые оказались слишком близко, чтобы подписи не налезали
  for (let it = 0; it < 40; it++) {
    for (const p of pts) for (const q of pts) {
      if (p === q) continue;
      const dx = q.x - p.x, dy = q.y - p.y, dist = Math.hypot(dx, dy) || 1;
      if (dist < 140) { const k = (140 - dist) / dist / 2; p.x -= dx * k; p.y -= dy * k * 0.6; q.x += dx * k; q.y += dy * k * 0.6; }
    }
    for (const p of pts) { p.x = Math.min(W - 70, Math.max(70, p.x)); p.y = Math.min(H - 60, Math.max(40, p.y)); }
  }
  // Линии: сборки из одной папки (или с одним загрузчиком) соединены
  const lines = [];
  const groups = {};
  for (const p of pts) (groups[(p.i.folder || '').trim() || 'loader:' + p.i.loader] ||= []).push(p);
  for (const g of Object.values(groups)) for (let k = 1; k < g.length; k++) lines.push([g[k - 1], g[k]]);
  const cur = selected();
  return `<section class="panel sky" aria-label="${esc(t('sky.title'))}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t('sky.title'))}">
      ${Array.from({ length: 70 }, (_, n) => `<circle cx="${(hash01('s' + n, 3) * W).toFixed(1)}" cy="${(hash01('s' + n, 5) * H).toFixed(1)}" r="${(0.4 + hash01('s' + n, 9) * 1.1).toFixed(2)}" fill="#fff" opacity="${(0.15 + hash01('s' + n, 11) * 0.5).toFixed(2)}"/>`).join('')}
      ${lines.map(([a, b]) => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="var(--accent)" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="4 4"/>`).join('')}
    </svg>
    ${pts.map((p) => `<button class="sky-star ${cur?.id === p.i.id ? 'on' : ''}" style="left:${(p.x / W) * 100}%;top:${(p.y / H) * 100}%;--r:${p.r * 2}px" data-action="pickInstance" data-id="${esc(p.i.id)}" aria-label="${esc(p.i.name)}">
      <span class="sky-dot"></span><span class="sky-label">${esc(p.i.name)}<small>${esc(formatPlayTime(p.i.playTimeSecs))}</small></span></button>`).join('')}
    <p class="small muted sky-note">${esc(t('sky.note'))}</p>
  </section>`;
}

// ---------- Энциклопедия ----------

const WIKI_LANGS = new Set(['ru', 'uk', 'de', 'es', 'ja', 'zh', 'pt']);
const wikiBase = () => (WIKI_LANGS.has(getLang()) ? `https://${getLang()}.minecraft.wiki` : 'https://minecraft.wiki');
let wikiTimer;
let wikiSeq = 0;

async function runWikiSearch() {
  const w = state.wiki;
  const q = w.query.trim();
  const seq = ++wikiSeq;
  if (!q) { w.results = null; return refreshWiki(); }
  w.loading = true; refreshWiki();
  try {
    const res = await fetch(`${wikiBase()}/api.php?action=query&list=search&format=json&origin=*&srlimit=12&srsearch=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (seq !== wikiSeq) return;
    w.results = (data.query?.search || []).map((x) => ({ title: x.title, snippet: String(x.snippet || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'") }));
    w.error = false;
  } catch {
    if (seq !== wikiSeq) return;
    w.results = []; w.error = true;
  }
  w.loading = false; refreshWiki();
}

function wikiResultsHtml() {
  const w = state.wiki;
  if (w.loading && !w.results) return `<div class="row" style="padding:10px"><span class="spinner"></span></div>`;
  if (w.error) return `<p class="warn">${esc(t('wiki.error'))}</p>`;
  if (!w.results) return '';
  if (!w.results.length) return `<p class="note">${esc(t('res.nothing'))}</p>`;
  return `<div class="list" style="padding:0">${w.results.map((r) => `<a href="#" class="list-row wiki-row" data-action="openWiki" data-url="${esc(wikiBase() + '/w/' + encodeURIComponent(r.title.replace(/ /g, '_')))}">
    <span class="thumb mod-icon" style="width:36px;height:36px" aria-hidden="true">${icon.book(16)}</span>
    <span class="stack grow" style="gap:2px;min-width:0"><b>${esc(r.title)}</b><span class="small muted ellipsis">${esc(r.snippet)}</span></span>${icon.chevronRight()}</a>`).join('')}</div>`;
}

function refreshWiki() {
  const box = $('#wiki-results');
  if (box && state.view === 'wiki') box.innerHTML = wikiResultsHtml();
}

async function loadWikiMods() {
  const w = state.wiki;
  w.mods = 'loading';
  const ids = new Set();
  const usedIn = {};
  for (const inst of visibleInstances()) {
    try { for (const pid of await api.installedProjects(inst.id)) { ids.add(pid); (usedIn[pid] ||= []).push(inst.name); } } catch { /* пропустим */ }
  }
  let list = [];
  const all = [...ids];
  try {
    for (let i = 0; i < all.length; i += 80) {
      const part = all.slice(i, i + 80);
      const res = await fetch(`https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(part))}`);
      list = list.concat(await res.json());
    }
  } catch { w.mods = 'error'; if (state.view === 'wiki') render(); return; }
  w.mods = list.filter((p) => p.project_type === 'mod' || p.project_type === 'shader' || p.project_type === 'resourcepack')
    .map((p) => ({ id: p.id, title: p.title, icon: p.icon_url || '', wiki: p.wiki_url || '', source: p.source_url || '', discord: p.discord_url || '', page: `https://modrinth.com/${p.project_type}/${p.slug}`, usedIn: usedIn[p.id] || [] }))
    .sort((a, b) => (b.wiki ? 1 : 0) - (a.wiki ? 1 : 0) || a.title.localeCompare(b.title));
  if (state.view === 'wiki') render();
}

function viewWiki() {
  const w = state.wiki;
  if (w.mods === null) loadWikiMods();
  const link = (url, label) => url ? `<button class="btn sm" data-action="openWiki" data-url="${esc(url)}">${esc(label)}</button>` : '';
  const mods = w.mods === 'loading' || w.mods === null
    ? `<div class="row" style="padding:12px"><span class="spinner"></span></div>`
    : w.mods === 'error' ? `<p class="warn">${esc(t('res.error', { source: 'Modrinth' }))}</p>`
    : w.mods.length ? `<div class="grid wiki-grid">${w.mods.map((m) => `<article class="panel wiki-card">
        <div class="row" style="gap:12px;flex-wrap:nowrap">${m.icon ? `<img class="thumb" style="width:40px;height:40px" src="${esc(m.icon)}" alt="" loading="lazy">` : `<span class="thumb" style="width:40px;height:40px;background:${TINTS[5]}"></span>`}
          <span class="stack" style="gap:2px;min-width:0"><b class="ellipsis">${esc(m.title)}</b><span class="small muted ellipsis">${esc(m.usedIn.join(', '))}</span></span></div>
        <div class="row" style="gap:6px">${m.wiki ? `<button class="btn sm accent" data-action="openWiki" data-url="${esc(m.wiki)}">${icon.book(14)}<span>${esc(t('wiki.guide'))}</span></button>` : `<span class="small muted">${esc(t('wiki.noGuide'))}</span>`}
          ${link(m.page, 'Modrinth')}${link(m.source, t('proj.link.source'))}</div>
      </article>`).join('')}</div>`
    : `<p class="note">${esc(t('wiki.noMods'))}</p>`;
  return `<div class="view">
    <h1 class="page-title">${esc(t('wiki.title'))}</h1>
    <section class="panel pad stack" style="gap:12px">
      <div class="stack" style="gap:2px"><h2 class="h2">${esc(t('wiki.mc'))}</h2><span class="note">${esc(t('wiki.mcSub'))}</span></div>
      <label for="wq" class="sr">${esc(t('wiki.search'))}</label>
      <input id="wq" class="input" type="search" placeholder="${esc(t('wiki.search'))}" value="${esc(w.query)}" data-bind="wiki.query" data-wiki-search>
      <div id="wiki-results">${wikiResultsHtml()}</div>
    </section>
    <section class="stack" style="gap:10px">
      <div class="stack" style="gap:2px;margin-left:4px"><h2 class="h2">${esc(t('wiki.mods'))}</h2><span class="note">${esc(t('wiki.modsSub'))}</span></div>
      ${mods}
    </section>
    <section class="panel pad stack" style="gap:10px">
      <h2 class="h2">${esc(t('wiki.links'))}</h2>
      <div class="row" style="gap:8px">
        ${link(wikiBase(), 'Minecraft Wiki')}${link('https://modrinth.com', 'Modrinth')}${link('https://wiki.fabricmc.net', 'Fabric Wiki')}${link('https://docs.neoforged.net', 'NeoForge Docs')}${link('https://docs.minecraftforge.net', 'Forge Docs')}
      </div>
    </section>
  </div>`;
}

// ---------- Ctrl+K ----------

function paletteItems() {
  const go = (view, extra = {}) => ({ run: () => { state.palette = null; if (view === 'resources' && !state.res.results) runSearch(); actions.nav({ view, ...extra }); } });
  const items = [];
  for (const i of state.instances) {
    items.push({ label: t('pal.play', { name: i.name }), hint: `${i.gameVersion} · ${loaderLabel(i.loader)}`, ic: 'play', run: () => { state.palette = null; actions.playInstance({ id: i.id }); } });
    items.push({ label: t('pal.settings', { name: i.name }), hint: t('pal.instance'), ic: 'gear', run: () => { state.palette = null; renderOverlay(); actions.openInstance({ id: i.id }); } });
  }
  for (const n of NAV) items.push({ label: t('nav.' + n.id), hint: t('pal.section'), ic: 'chevronRight', ...go(n.view) });
  items.push({ label: t('acc.title'), hint: t('pal.section'), ic: 'chevronRight', ...go('accounts') });
  items.push({ label: t('book.title'), hint: t('pal.section'), ic: 'book', ...go('book') });
  for (const k of ['look', 'sound', 'game', 'general']) items.push({ label: t('set.title') + ': ' + t('set.tab.' + k), hint: t('pal.section'), ic: 'gear', run: () => { state.palette = null; state.setTab = k; go('settings').run(); } });
  items.push({ label: t('home.newInstance'), hint: t('pal.action'), ic: 'sparkle', run: () => { state.palette = null; actions.openCreate(); } });
  items.push({ label: t('inst.import'), hint: t('pal.action'), ic: 'upload', run: () => { state.palette = null; renderOverlay(); actions.importPack(); } });
  items.push({ label: t('prism.button'), hint: t('pal.action'), ic: 'move', run: () => { state.palette = null; actions.openPrism(); } });
  items.push({ label: t('mini.enter'), hint: t('pal.action'), ic: 'box', run: () => { state.palette = null; actions.toggleMini(); } });
  items.push({ label: t('bug.title'), hint: t('pal.action'), ic: 'warn', run: () => { state.palette = null; actions.openBugReport(); } });
  for (const id of THEME_ORDER) items.push({ label: t('pal.theme', { name: t('theme.' + id) }), hint: t('set.theme'), ic: 'palette', run: () => { state.palette = null; actions.setTheme({ theme: id }); } });
  return items;
}

function paletteResults() {
  const q = state.palette.query.trim();
  const all = paletteItems();
  if (!q) return all.slice(0, 9);
  return all.map((x) => ({ x, sc: matchScore(q, x.label, x.hint) })).filter((r) => r.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 9).map((r) => r.x);
}

function paletteListHtml() {
  const list = paletteResults();
  state.palette.sel = Math.min(state.palette.sel, Math.max(0, list.length - 1));
  return list.length ? list.map((x, n) => `<button class="pal-item" role="option" aria-selected="${n === state.palette.sel}" data-action="palRun" data-n="${n}">
      <span class="pal-ico">${(icon[x.ic] || icon.chevronRight)(16)}</span><span class="grow ellipsis">${esc(x.label)}</span><span class="small muted">${esc(x.hint)}</span>
    </button>`).join('') : `<p class="note" style="padding:12px">${esc(t('pal.nothing'))}</p>`;
}

function paletteHtml() {
  return `<div class="overlay" style="padding-top:90px" data-action="closePalette"><div class="dialog palette" role="dialog" aria-modal="true" aria-label="${esc(t('pal.open'))}" data-stop>
    <div class="row" style="gap:10px;flex-wrap:nowrap">${icon.search(18)}
      <input id="pal-input" class="input" style="border:0;box-shadow:none;background:transparent;font-size:calc(16px*var(--fs,1))" placeholder="${esc(t('pal.placeholder'))}" value="${esc(state.palette.query)}" data-bind="palette.query" data-palette autofocus></div>
    <div class="pal-list" role="listbox" id="pal-list">${paletteListHtml()}</div>
    <span class="small muted">${esc(t('pal.hint'))}</span>
  </div></div>`;
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
      ${doctorCards(diagnose(d.log, d.crash || ''))}
      <pre class="log" style="max-height:200px">${esc(d.log || '—')}</pre>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="crashLogs" data-id="${esc(d.id)}">${icon.note()}<span>${esc(t('logs.open'))}</span></button>
        <button class="btn" data-action="openBugReport">${esc(t('bug.title'))}</button>
        <button class="btn" data-action="copyLog">${esc(t('launch.copyLog'))}</button>
        <button class="btn accent" data-action="closeDialog">${esc(t('common.close'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'update' && state.update) html += updateDialog();
  if (d?.type === 'rename') {
    html += `<div class="overlay" data-action="closeDialog"><form class="dialog" style="max-width:440px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop data-submit="renameSubmit">
      <h2 id="dlg-title">${esc(t(d.profile ? 'prof.saveTitle' : 'rename.title'))}</h2>
      ${d.profile ? `<p class="note">${esc(t('prof.saveSub'))}</p>` : ''}
      <label for="rename-input" class="sr">${esc(t('rename.title'))}</label>
      <input id="rename-input" class="input" maxlength="60" value="${esc(d.name)}" data-bind="dialog.name" placeholder="${esc(d.profile ? t('prof.placeholder') : '')}" autofocus>
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
  if (d?.type === 'prismAccounts') {
    let body;
    if (!d.list) body = `<div class="row"><span class="spinner"></span><span class="muted">${esc(t('prism.searching'))}</span></div>`;
    else if (!d.list.length) body = `<p class="note">${esc(t('acc.prismNone'))}</p>`;
    else body = `<div class="list" style="padding:0">${d.list.map((a) => `<div class="list-row">
        <span class="avatar">${esc(a.name.charAt(0).toUpperCase())}</span>
        <div class="stack grow" style="gap:2px"><b>${esc(a.name)}</b>
          <span class="small ${a.fresh ? 'muted' : 'warn'}">${esc(t(a.fresh ? 'acc.prismFresh' : 'acc.prismStale'))}</span></div>
        <button class="btn sm accent" data-action="addPrismAccount" data-id="${esc(a.id)}">${esc(t('acc.prismUse'))}</button>
      </div>`).join('')}</div>`;
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:520px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('acc.prismTitle'))}</h2><p class="note">${esc(t('acc.prismHow'))}</p></div>
      ${body}
      <div class="row" style="justify-content:flex-end"><button class="btn" data-action="closeDialog">${esc(t('common.close'))}</button></div>
    </div></div>`;
  }
  if (d?.type === 'prismRefresh') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="align-items:flex-start;gap:14px;flex-wrap:nowrap">
        <span class="avatar" style="background:var(--accent-soft);color:var(--accent-text)">${icon.restore(20)}</span>
        <div class="stack" style="gap:6px"><h2 id="dlg-title">${esc(t('launch.prismRefreshTitle'))}</h2><p class="note">${esc(t('launch.prismRefreshText'))}</p></div>
      </div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog">${esc(t('common.close'))}</button>
        <button class="btn accent" data-action="retryLaunch" data-id="${esc(d.id)}">${esc(t('launch.prismRetry'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'project') html += projectDialog(d);
  if (d?.type === 'precheck') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:560px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="row" style="gap:14px;flex-wrap:nowrap;align-items:flex-start"><span class="avatar" style="background:var(--warn-soft);color:var(--warn-text)">${icon.warn()}</span>
        <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('pre.title'))}</h2><p class="note">${esc(t('pre.sub'))}</p></div></div>
      <div class="stack" style="gap:8px">${d.problems.map((p) => `<div class="doc-card"><span class="doc-ico">${icon.warn(16)}</span><span class="stack" style="gap:2px"><b>${esc(t('pre.' + p.kind + '.title', { name: p.name, detail: p.detail, kind: t('loader.' + (p.detail === 'legacy' ? 'forge' : p.detail)) }))}</b><span class="note">${esc(t('pre.' + p.kind + '.text', { name: p.name, detail: p.detail }))}</span></span></div>`).join('')}</div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="openInstance" data-id="${esc(d.id)}" data-tab="mods">${esc(t('news.openMods'))}</button>
        <button class="btn accent" data-action="launchAnyway" data-id="${esc(d.id)}">${esc(t('pre.anyway'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'compare') html += compareDialog(d);
  if (d?.type === 'restoreSnap') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="stack" style="gap:6px"><h2 id="dlg-title">${esc(t('tm.restoreTitle'))}</h2><p class="note">${esc(t('tm.restoreText'))}</p></div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button class="btn accent" data-action="restoreSnap" data-file="${esc(d.file)}" ${d.busy ? 'disabled' : ''}>${d.busy ? '<span class="spinner"></span>' : ''}${esc(t('tm.restore'))}</button>
      </div></div></div>`;
  }
  if (d?.type === 'patch') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog project-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <h2 id="dlg-title">${esc(d.title)}</h2>
      <div class="proj-body">${d.body === null ? '<div class="row"><span class="spinner"></span></div>' : `<div class="md">${safeMarkdown(d.body)}</div>`}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn accent" data-action="closeDialog">${esc(t('common.close'))}</button></div>
    </div></div>`;
  }
  if (d?.type === 'bug') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:620px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('bug.title'))}</h2><p class="note">${esc(t('bug.sub'))}</p></div>
      <div class="field"><label for="bug-what" class="label">${esc(t('bug.what'))}</label>
        <textarea id="bug-what" class="input" rows="4" maxlength="3000" placeholder="${esc(t('bug.placeholder'))}" data-bind="dialog.text">${esc(d.text)}</textarea></div>
      <label class="check-row" style="padding:0"><input type="checkbox" data-bug-logs ${d.withLogs ? 'checked' : ''}><span class="note">${esc(t('bug.withLogs'))}</span></label>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="closeDialog">${esc(t('common.cancel'))}</button>
        <button class="btn" data-action="bugGithub">${esc(t('bug.github'))}</button>
        <button class="btn accent" data-action="bugCopy">${icon.copy()}<span>${esc(t('bug.copy'))}</span></button>
      </div></div></div>`;
  }
  if (d?.type === 'manual') {
    html += `<div class="overlay" data-action="closeDialog"><div class="dialog" style="max-width:560px" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop>
      <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t('cf.manualTitle', { n: d.list.length }))}</h2><p class="note">${esc(t('cf.manualText'))}</p></div>
      <div class="list" style="padding:0;max-height:300px;overflow:auto">${d.list.map((f) => `<div class="list-row"><span class="grow">${esc(f.name)}</span>
        <button class="btn sm" data-action="openUrl" data-url="${esc(f.url)}">${esc(t('cf.download'))}</button></div>`).join('')}</div>
      <div class="row" style="justify-content:flex-end">
        <button class="btn" data-action="openModsFolder" data-id="${esc(d.id)}">${icon.folder(16)}<span>${esc(t('mods.openFolder'))}</span></button>
        <button class="btn accent" data-action="closeDialog">${esc(t('common.close'))}</button>
      </div></div></div>`;
  }
  if (state.palette) html += paletteHtml();
  if (state.wrapped) html += wrappedHtml();
  if (state.ach) html += achToastHtml();
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
    const color = (key, label, optional = false) => `<label class="color-row"><input type="color" value="${esc(d[key] || (key === 'card' ? '#1A2440' : d.accent))}" data-bind="dialog.${key}" data-live-theme>
      <span class="stack" style="gap:2px"><span>${esc(label)}</span><span class="small muted mono">${esc(d[key] || (optional ? t('te.auto') : ''))}</span></span></label>`;
    const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-action="teSet" data-k="${key}" data-v="${v}" ${pressed(String(d[key] ?? '') === String(v))}>${esc(l)}</button>`).join('')}</div>`;
    html += `<div class="overlay side" data-action="closeDialog"><form class="dialog" style="max-width:420px;max-height:calc(100vh - 80px);overflow:auto" role="dialog" aria-modal="true" aria-labelledby="dlg-title" data-stop data-submit="saveTheme">
      <div class="stack" style="gap:4px"><h2 id="dlg-title">${esc(t(d.id ? 'te.editTitle' : 'te.createTitle'))}</h2><p class="note">${esc(t('te.sub'))}</p></div>
      <div class="field"><label for="te-name" class="label">${esc(t('te.name'))}</label>
        <input id="te-name" class="input" maxlength="30" value="${esc(d.name)}" data-bind="dialog.name" placeholder="${esc(t('te.namePlaceholder'))}"></div>
      <span class="eyebrow-mono">${esc(t('te.secBg'))}</span>
      ${color('bg', t('te.bg'))}
      <div class="stack" style="gap:6px"><span class="small muted">${esc(t('te.bgMode'))}</span>${seg('bgMode', [['solid', t('te.mode.solid')], ['vertical', t('te.mode.vertical')], ['diagonal', t('te.mode.diagonal')], ['glow', t('te.mode.glow')]])}</div>
      ${d.bgMode && d.bgMode !== 'solid' ? color('bg2', t('te.bg2'), true) : ''}
      <div class="stack" style="gap:6px"><span class="small muted">${esc(t('te.pattern'))}</span>${seg('pattern', [['', t('te.pat.none')], ['dots', t('te.pat.dots')], ['grid', t('te.pat.grid')], ['pixels', t('te.pat.pixels')], ['stars', t('te.pat.stars')]])}</div>
      <span class="eyebrow-mono">${esc(t('te.secAccent'))}</span>
      ${color('accent', t('te.accent'))}
      <button type="button" class="switch-row" role="switch" aria-checked="${!!d.accent2}" data-action="teToggleGrad"><span>${esc(t('te.accentGrad'))}</span><span class="switch"></span></button>
      ${d.accent2 ? color('accent2', t('te.accent2')) : ''}
      <div class="range-row"><label for="te-glow" class="label">${esc(t('te.glow'))}</label><output id="te-glow-out">${d.glow ?? 50}%</output>
        <input id="te-glow" type="range" min="0" max="100" step="5" value="${d.glow ?? 50}" style="grid-column:1 / -1" data-bind="dialog.glow" data-number data-unit="%" data-live-theme></div>
      <span class="eyebrow-mono">${esc(t('te.secSurface'))}</span>
      ${color('text', t('te.text'))}
      ${color('card', t('te.card'), true)}
      <div class="stack" style="gap:6px"><span class="small muted">${esc(t('te.depth'))}</span>${seg('depth', [[0, t('te.depth.0')], [1, t('te.depth.1')], [2, t('te.depth.2')]])}</div>
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

function viewMini() {
  const cur = selected();
  return `<div class="mini" data-tauri-drag-region style="${cur ? coverBg(cur, true) : ''}">
    <div class="mini-inner" data-tauri-drag-region>
      <div class="row between" data-tauri-drag-region style="flex-wrap:nowrap">
        <span class="row" style="gap:8px" data-tauri-drag-region>${icon.moon(16)}<b data-tauri-drag-region>Spectia</b></span>
        <span class="row" style="gap:2px;flex-wrap:nowrap">
          <button class="winbtn" data-action="toggleMini" aria-label="${esc(t('mini.exit'))}" title="${esc(t('mini.exit'))}">${icon.maximize()}</button>
          <button class="winbtn close" data-action="winClose" aria-label="${esc(t('win.close'))}">${icon.close()}</button>
        </span>
      </div>
      ${cur ? `<label for="mini-sel" class="sr">${esc(t('inst.title'))}</label>
        <select id="mini-sel" class="input" data-change="miniSelect">${visibleInstances().map((i) => `<option value="${esc(i.id)}" ${i.id === cur.id ? 'selected' : ''}>${esc(i.name)} · ${esc(i.gameVersion)}</option>`).join('')}</select>
        ${state.progress[cur.id] ? progressBar(cur.id) : ''}
        ${playButton(cur.id)}` : `<p class="note">${esc(t('home.emptyTitle'))}</p>`}
    </div>
  </div>`;
}

/** Перерисовывает окно. scrollTop=true — прокрутить новый экран наверх. */
let lastView = null;
function render(scrollTop = false) {
  document.body.classList.toggle('is-mini', state.mini);
  setAquarium(!!state.settings?.aquarium && state.view === 'home' && !state.mini);
  if (state.mini) {
    $('#titlebar').innerHTML = '';
    $('#sidebar').innerHTML = '';
    $('#content').innerHTML = viewMini();
    renderOverlay();
    return;
  }
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
    const results = await searchModrinth({ query: r.query, kind: r.kind, gameVersion: target?.gameVersion, loader: target?.loader, categories: r.cats });
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
  PRISM_GONE: () => t('launch.prismGone'),
  MS_NOT_CONFIGURED: () => t('acc.msPendingSub'),
};

const stopping = new Set();

async function launch(id, force = false) {
  if (state.progress[id] || state.running.has(id)) return;
  if (!force) {
    let problems = [];
    try { problems = await api.precheck(id); } catch { /* проверка не главное */ }
    if (problems.length) {
      state.dialog = { type: 'precheck', id, problems };
      renderOverlay();
      return;
    }
  }
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
    finishDownload(id, false);
    delete state.progress[id];
    const code = String(e);
    const inst = state.instances.find((i) => i.id === id);
    if (code === 'NO_ACCOUNT') { state.dialog = { type: 'noAccount' }; }
    else if (code.startsWith('NO_LOADER_FOR_VERSION')) toast(t('launch.noLoaderVersion', { loader: t('loader.' + (inst?.loader || 'fabric')), version: inst?.gameVersion }), true);
    else if (code.startsWith('LOADER_INSTALL_FAILED')) state.dialog = { type: 'crash', id, log: code.replace(/^LOADER_INSTALL_FAILED:\s*/, '') };
    else if (code.startsWith('JAVA_START_FAILED')) toast(t('launch.javaFailed'), true);
    else if (code === 'PRISM_REFRESH') state.dialog = { type: 'prismRefresh', id };
    else if (LAUNCH_ERRORS[code]) toast(LAUNCH_ERRORS[code](), true);
    else toast(t('launch.failed', { message: code }), true);
    if (code === 'ELY_RELOGIN' || code === 'MS_RELOGIN') { state.view = 'accounts'; }
  }
  render();
}

function subscribe() {
  on('net-stats', onNetStats);
  on('launch-progress', (p) => {
    onLaunchProgress(p);
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
    finishDownload(g.instanceId, true);
    delete state.progress[g.instanceId];
    if (g.running) {
      state.running.add(g.instanceId);
      petMood(true);
      const inst = state.instances.find((i) => i.id === g.instanceId);
      celebrate('ready', t('notify.readyTitle'), t('notify.readyBody', { name: inst?.name || 'Minecraft' }));
    } else {
      state.running.delete(g.instanceId);
      petMood(state.running.size > 0);
      state.week = null;
      delete homeInfo[g.instanceId];
      setTimeout(checkAchievements, 1500);
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
    const res = await api.importPack(path);
    state.importing = null;
    if (!res) return renderOverlay();
    const inst = res.instance;
    if (res.manual?.length) state.dialog = { type: 'manual', list: res.manual, id: inst.id };
    await loadInstances();
    state.selectedId = inst.id;
    state.view = 'home';
    render(true);
    toast(t('inst.imported', { name: inst.name }));
    celebrate('done', t('notify.doneTitle'), t('inst.imported', { name: inst.name }));
  } catch (e) {
    state.importing = null;
    const code = String(e);
    toast(code === 'NOT_MRPACK' || code === 'NOT_A_PACK' ? t('inst.notMrpack') : code === 'CF_NO_KEY' ? t('cf.noKey') : t('error.generic', { message: e }), true);
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

// ---------- Музыка: один плеер на всё окно ----------

const audio = new Audio();
audio.addEventListener('play', () => { state.music.playing = true; refreshPlayer(); });
audio.addEventListener('pause', () => { state.music.playing = false; refreshPlayer(); });
audio.addEventListener('ended', () => {
  if (state.music.sleep?.mode === -1) { state.music.sleep = null; state.music.playing = false; refreshPlayer(); return; }
  const r = state.settings.musicRepeat || 'all';
  if (r === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
  const list = musicQueue();
  const last = list.findIndex((x) => x.key === state.music.current?.key) === list.length - 1;
  if (r === 'off' && last && !state.music.shuffle) { state.music.playing = false; refreshPlayer(); return; }
  nextTrack();
});
audio.addEventListener('timeupdate', () => refreshSeek());
audio.addEventListener('loadedmetadata', () => refreshSeek());

// Таймер сна: в последние 8 секунд музыка плавно затихает
setInterval(() => {
  const sl = state.music.sleep;
  if (!sl?.until) return;
  const left = sl.until - Date.now();
  const base = Math.min(1, (state.settings.musicVolume ?? 70) / 100);
  if (left <= 0) {
    audio.pause(); audio.volume = base; state.music.sleep = null; refreshPlayer();
  } else if (left < 8000) {
    audio.volume = base * (left / 8000);
  }
  refreshSeek();
}, 1000);

function prevTrack() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const list = musicQueue();
  const at = list.findIndex((x) => x.key === state.music.current?.key);
  playTrack(list[(at - 1 + list.length) % list.length]);
}

function refreshPlayer() {
  if (state.mini) return;
  renderChrome();
  if (state.view === 'music') render();
}

function musicQueue() {
  const mu = state.music;
  const fav = favs();
  return (mu.list || []).filter((x) => mu.group === 'all' || (mu.group === 'fav' ? fav.has(x.key) : x.group === mu.group));
}

function playTrack(track) {
  if (!track) return;
  if (!inApp || !track.path) return toast(t('music.previewOnly'));
  state.music.current = track;
  audio.volume = Math.min(1, (state.settings.musicVolume ?? 70) / 100);
  loadTrackSrc(track).then(() => audio.play()).catch(() => toast(t('music.cantPlay'), true));
  refreshPlayer();
}

/**
 * Загружаем трек целиком в память и играем оттуда: так перемотка работает всегда,
 * даже если файл открыт через особый адрес приложения.
 */
let blobUrl = '';
async function loadTrackSrc(track) {
  const url = fileUrl(track.path);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (state.music.current?.key !== track.key) return;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);
    audio.src = blobUrl;
  } catch {
    audio.src = url;
  }
}

function nextTrack() {
  const list = musicQueue();
  if (!list.length) return;
  const at = list.findIndex((x) => x.key === state.music.current?.key);
  const next = state.music.shuffle ? list[Math.floor(Math.random() * list.length)] : list[(at + 1) % list.length];
  playTrack(next);
}

// ---------- Достижения ----------

const achQueue = [];
let achTimer = null;

function bump(counter, n = 1) {
  const c = (state.settings.counters ||= {});
  c[counter] = (c[counter] || 0) + n;
  saveSettings();
  checkAchievements();
}

async function checkAchievements() {
  if (!state.settings) return;
  let sessions = Array.isArray(state.week) ? state.week : [];
  if (!Array.isArray(state.week)) { try { sessions = await api.statsSessions(); state.week = sessions; } catch { sessions = []; } }
  const unlocked = (state.settings.achievements ||= {});
  const fresh = newlyUnlocked(facts({ sessions, instances: state.instances, settings: state.settings }), unlocked);
  if (!fresh.length) return;
  for (const id of fresh) { unlocked[id] = Math.floor(Date.now() / 1000); achQueue.push(id); }
  saveSettings();
  if (fresh.includes('legend')) toast(t('book.legendReward'));
  showNextAch();
}

function showNextAch() {
  if (state.ach || !achQueue.length) return;
  state.ach = achQueue.shift();
  const s = state.settings;
  if (s.sound !== false) chime('done', (s.soundVolume ?? 60) / 100);
  if (s.notifications !== false && !document.hasFocus()) api.notify(t('ach.got'), t('ach.' + state.ach)).catch(() => {});
  renderOverlay();
  clearTimeout(achTimer);
  achTimer = setTimeout(() => { state.ach = null; renderOverlay(); setTimeout(showNextAch, 400); }, tierOf(state.ach) === 'netherite' ? 7000 : 5000);
}

function achToastHtml() {
  const a = findAch(state.ach);
  if (!a) return '';
  const tier = a.tier || 'seasonal';
  const sparks = tier === 'diamond' || tier === 'netherite' ? '<i></i><i></i><i></i><i></i><i></i><i></i>' : '';
  return `${tier === 'netherite' ? '<div class="ach-flash" aria-hidden="true"></div>' : ''}
    <div class="ach-toast tier-${tier}" role="status"><span class="ach-sparks" aria-hidden="true">${sparks}</span><span class="ach-ico">${artSvg(a.art, 28)}</span>
    <span class="stack" style="gap:2px"><span class="t1">${esc(t(SEASONAL.includes(a) ? 'ach.gotSeasonal' : 'ach.got'))}</span><b>${esc(t('ach.' + a.id))}</b>
    <span class="t2">${esc(t('tier.' + tier))}</span></span></div>`;
}

const achDate = (sec) => new Date(sec * 1000).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long', year: 'numeric' });

function achCard(a, got) {
  const tier = a.tier || 'seasonal';
  return `<div class="ach-card tier-${tier} ${got ? '' : 'locked'}">
    <span class="ach-ico">${artSvg(a.art, 28)}</span>
    <span class="stack" style="gap:2px;min-width:0"><b>${esc(t('ach.' + a.id))}</b><span class="small muted">${esc(t('ach.' + a.id + '.how'))}</span>
    ${got ? `<span class="mono small ach-date">${esc(achDate(got))}</span>` : ''}</span>
  </div>`;
}

/** Короткий блок в профиле: сколько собрано + кнопка книги */
function achievementsHtml() {
  const got = state.settings.achievements || {};
  const all = [...ACHIEVEMENTS, PERFECT];
  const n = all.filter((a) => got[a.id]).length;
  const recent = Object.entries(got).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => findAch(id)).filter(Boolean);
  return `<section class="panel pad stack" style="gap:12px">
    <div class="row between">
      <div class="stack" style="gap:2px"><h2 class="h2">${esc(t('ach.title'))}</h2><span class="mono small muted">${n} / ${all.length} · ${esc(t('book.seasonalShort', { n: SEASONAL.filter((x) => got[x.id]).length, all: SEASONAL.length }))}</span></div>
      <button class="btn accent" data-action="nav" data-view="book">${icon.book ? icon.book(16) : ''}<span>${esc(t('book.open'))}</span></button>
    </div>
    ${recent.length ? `<div class="ach-grid">${recent.map((a) => achCard(a, got[a.id])).join('')}</div>` : `<p class="note">${esc(t('book.empty'))}</p>`}
  </section>`;
}

// ---------- Книга достижений ----------

function viewBook() {
  const got = state.settings.achievements || {};
  const page = state.bookPage || 'tiers';
  const tabs = ['tiers', 'chains', 'seasonal'].map((k) => `<button role="tab" aria-selected="${page === k}" data-action="setBookPage" data-p="${k}">${esc(t('book.page.' + k))}</button>`).join('');
  let body = '';
  if (page === 'tiers') {
    body = [...TIERS].reverse().map((tier) => {
      const list = [...ACHIEVEMENTS, PERFECT].filter((a) => a.tier === tier);
      return `<div class="book-chapter"><h3 class="book-h tier-text-${tier}">${esc(t('tier.' + tier))} <span class="mono small muted">${list.filter((a) => got[a.id]).length} / ${list.length}</span></h3>
        <div class="ach-grid">${list.map((a) => achCard(a, got[a.id])).join('')}</div></div>`;
    }).join('');
  } else if (page === 'chains') {
    const chains = [...new Set(ACHIEVEMENTS.filter((a) => a.chain).map((a) => a.chain))];
    body = chains.map((c) => {
      const steps = ACHIEVEMENTS.filter((a) => a.chain === c).sort((a, b) => a.step - b.step);
      const done = steps.filter((a) => got[a.id]).length;
      return `<div class="book-chapter"><h3 class="book-h">${esc(t('chain.' + c))} <span class="mono small muted">${done} / ${steps.length}</span></h3>
        <div class="chain">${steps.map((a, i) => `${i ? `<span class="chain-link ${got[a.id] ? 'on' : ''}" aria-hidden="true"></span>` : ''}${achCard(a, got[a.id])}`).join('')}</div></div>`;
    }).join('');
  } else {
    body = `<p class="note">${esc(t('book.seasonalNote'))}</p><div class="ach-grid">${SEASONAL.map((a) => achCard(a, got[a.id])).join('')}</div>`;
  }
  const all = [...ACHIEVEMENTS, PERFECT];
  const n = all.filter((a) => got[a.id]).length;
  return `<div class="view">
    ${pageHead(t('book.title'), 'goBack')}
    <section class="book">
      <div class="book-cover">
        <span class="book-crest">${artSvg('book', 56)}</span>
        <div class="stack" style="gap:4px"><span class="eyebrow-mono">${esc(t('book.sub'))}</span><b class="book-count">${n} / ${all.length}</b>
          <span class="bar" style="width:220px"><span style="width:${Math.round((n / all.length) * 100)}%"></span></span></div>
        ${got.legend ? `<p class="note" style="color:var(--accent-text)">${esc(t('book.legendReward'))}</p>` : `<p class="note">${esc(t('book.legendHint'))}</p>`}
      </div>
      <div class="book-pages stack" style="gap:16px">
        <div class="tabs" role="tablist">${tabs}</div>
        ${body}
      </div>
    </section>
  </div>`;
}

// ---------- Spectia Wrapped ----------

function wrappedBanner() {
  const year = wrappedYear();
  if (!year || !Array.isArray(state.week)) return '';
  if (!wrappedData(state.week, year)) return '';
  return `<section class="panel pad-s row between" style="gap:14px;background:var(--accent-fill);color:var(--accent-ink)">
    <div class="stack" style="gap:2px"><span class="eyebrow-mono" style="color:inherit;opacity:.8">Spectia Wrapped</span><b style="font-size:calc(18px*var(--fs,1))">${esc(t('wr.banner', { year }))}</b></div>
    <button class="btn" style="color:var(--text)" data-action="openWrapped">${esc(t('wr.open'))}</button>
  </section>`;
}

function wrappedSlides(d) {
  const months = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 1).toLocaleDateString(document.documentElement.lang, { month: 'long' }));
  const slides = [
    { eyebrow: t('wr.s1'), big: String(d.year), text: t('wr.s1t') },
    { eyebrow: t('wr.s2'), big: formatPlayTime(d.total), text: t('wr.s2t', { n: d.sessions, days: d.days }) },
    { eyebrow: t('wr.s3'), big: d.topInstance[0], text: t('wr.s3t', { t: formatPlayTime(d.topInstance[1]), n: d.instances }) },
    { eyebrow: t('wr.s4'), big: d.topVersion || '—', text: t('wr.s4t', { loader: loaderLabel(d.topLoader || 'vanilla') }) },
    { eyebrow: t('wr.s5'), big: formatPlayTime(d.longest.seconds), text: t('wr.s5t', { name: d.longest.name, date: new Date(d.longest.start * 1000).toLocaleDateString(document.documentElement.lang, { day: 'numeric', month: 'long' }) }) },
    { eyebrow: t('wr.s6'), big: months[d.topMonth], text: d.night ? t('wr.s6n', { n: d.night }) : t('wr.s6t') },
    { eyebrow: t('wr.s7'), big: `${Object.keys(state.settings.achievements || {}).length} / ${ACHIEVEMENTS.length}`, text: t('wr.s7t') },
  ];
  return slides;
}

function wrappedHtml() {
  const w = state.wrapped;
  const slides = wrappedSlides(w.data);
  const sl = slides[w.slide];
  return `<div class="wrapped" data-action="closeWrapped"><div class="wr-card" role="dialog" aria-modal="true" aria-label="Spectia Wrapped" data-stop>
    <div class="row between"><span class="eyebrow-mono" style="color:#fff">Spectia Wrapped · ${w.data.year}</span>
      <button class="icon-btn" style="width:34px;height:34px;background:rgba(0,0,0,.25);color:#fff" data-action="closeWrapped" aria-label="${esc(t('common.close'))}">${icon.close()}</button></div>
    <div class="stack" style="gap:14px">
      <span class="eyebrow-mono" style="color:rgba(255,255,255,.85)">${esc(sl.eyebrow)}</span>
      <div class="wr-big">${esc(sl.big)}</div>
      <p style="font-size:calc(17px*var(--fs,1));line-height:1.5;color:rgba(255,255,255,.92)">${esc(sl.text)}</p>
    </div>
    <div class="row between">
      <span class="wr-dots">${slides.map((_, n) => `<i class="${n === w.slide ? 'on' : ''}"></i>`).join('')}</span>
      <span class="row" style="gap:8px">
        ${w.slide > 0 ? `<button class="btn" data-action="wrappedStep" data-d="-1">${esc(t('common.back'))}</button>` : ''}
        ${w.slide < slides.length - 1 ? `<button class="btn" data-action="wrappedStep" data-d="1">${esc(t('wr.next'))}</button>` : `<button class="btn" data-action="closeWrapped">${esc(t('wr.done'))}</button>`}
      </span>
    </div>
  </div></div>`;
}

/** Музыка в меню: «Любимое» вперемешку (или все треки, если любимых нет) */
async function startMenuMusic() {
  if (state.music.list === null) await loadMusic();
  const fav = favs();
  const pool = (state.music.list || []).filter((x) => !fav.size || fav.has(x.key));
  if (!pool.length || !inApp) return;
  state.music.shuffle = true;
  state.music.group = fav.size ? 'fav' : 'all';
  const track = pool[Math.floor(Math.random() * pool.length)];
  state.music.current = track;
  await loadTrackSrc(track);
  audio.volume = Math.min(1, (state.settings.musicVolume ?? 70) / 100);
  // Если система не даёт играть звук без нажатия — начнём при первом клике
  audio.play().catch(() => document.addEventListener('pointerdown', () => audio.play().catch(() => {}), { once: true }));
  refreshPlayer();
}

// ---------- Баг-репорт ----------

async function bugText() {
  const d = state.dialog || {};
  const inst = state.edit || selected();
  const lines = [
    `**${t('bug.what')}**`,
    d.text?.trim() || '—',
    '',
    `**Spectia** ${APP_VERSION} · ${navigator.userAgent.match(/Windows NT [\d.]+|Mac OS X [\d_]+|Linux/)?.[0] || navigator.platform}`,
    `${t('set.theme')}: ${state.settings.theme} · ${t('set.language')}: ${state.settings.language} · ${t('look.scale')}: ${Math.round((state.settings.uiScale || 1) * 100)}%`,
  ];
  if (inst) lines.push(`${t('bug.instance')}: ${inst.name} · Minecraft ${inst.gameVersion} · ${inst.loader}${inst.loaderVersion ? ' ' + inst.loaderVersion : ''}`);
  if (d.withLogs !== false && inst) {
    let log = '';
    try { log = (await api.gameLogs(inst.id)).launcher.split('\n').slice(-60).join('\n'); } catch { /* без лога */ }
    // На всякий случай прячем всё, что похоже на ключи и токены
    log = log.replace(/(--accessToken\s+|accessToken[=:]\s*|token[=:]\s*)\S+/gi, '$1***').replace(/eyJ[\w-]{10,}\.[\w-]+\.[\w-]+/g, '***');
    if (log.trim()) lines.push('', `**${t('bug.log')}**`, '```', log, '```');
  }
  return lines.join('\n');
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
      loadFaces();
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
    state.dialog = null;
    state.advOpen = false;
    state.instTab = d.tab || 'general';
    state.editSnapshots = false;
    state.mods = { id: null, list: null, loading: false, query: '', dragging: false };
    state.modSel = new Set();
    state.modView = 'list';
    state.logs = { ...state.logs, id: null, data: null, query: '', filter: 'all', source: 'launcher' };
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
    if (d.tab === 'mods') { state.mods.list = null; state.deps.id = null; }
    if (d.tab === 'logs') state.logs.data = null;
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
      bump('installs');
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
      try { await api.makeSnapshot(state.edit.id, t('tm.beforeUpdate'), true); } catch { /* без снимка тоже можно */ }
      const n = await api.applyModUpdates(state.edit.id, d.list.filter((_, i) => d.picked.has(i)));
      state.dialog = null;
      toast(t('mods.updDone', { n }));
      if (n) bump('updates', n);
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
      state.deps.id = null;
      render();
    } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  deleteMod: async (d) => {
    try {
      await api.deleteMod(state.edit.id, d.file);
      state.mods.list = state.mods.list.filter((x) => x.file !== d.file);
      state.modSel.delete(d.file);
      state.deps.id = null;
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
    if (d.profile) {
      if (!d.name.trim()) return;
      try { state.profiles.list = await api.saveProfile(d.id, d.name.trim()); toast(t('prof.saved', { name: d.name.trim() })); } catch (e) { toast(t('error.generic', { message: e }), true); }
      state.dialog = null; render();
      return;
    }
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

  setKind: (d) => { state.res.kind = d.kind; state.res.cats = []; state.res.results = null; runSearch(); render(); },
  setSource: (d) => { state.res.source = d.source; render(); if (d.source === 'modrinth' && !state.res.results) runSearch(); },
  search: () => runSearch(),

  // ---------- 0.8 ----------
  openWiki: (d) => { openUrl(d.url); bump('wiki'); },
  setBookPage: (d) => { state.bookPage = d.p; render(); },
  undoEvent: async (d) => {
    try {
      const file = await api.undoEvent(state.edit.id, Number(d.time), d.restore);
      toast(t('hist.undone', { file }));
      state.history.list = null; state.mods.list = null; state.deps.id = null;
      bump('restores');
    } catch (e) { toast(String(e) === 'TRASH_GONE' ? t('hist.trashGone') : t('error.generic', { message: e }), true); }
    render();
  },
  saveProfile: () => { state.dialog = { type: 'rename', profile: true, id: state.edit.id, name: '' }; renderOverlay(); $('#rename-input')?.focus(); },
  applyProfile: async (d) => {
    try { const n = await api.applyProfile(state.edit.id, d.name); toast(t('prof.applied', { name: d.name, n })); state.mods.list = null; state.deps.id = null; } catch (e) { toast(t('error.generic', { message: e }), true); }
    render();
  },
  deleteProfile: async (d) => {
    try { state.profiles.list = await api.deleteProfile(state.edit.id, d.name); } catch (e) { toast(t('error.generic', { message: e }), true); }
    render();
  },
  makeSnapshot: async () => {
    state.snaps.busy = true; render();
    try { await api.makeSnapshot(state.edit.id, t('tm.manual', { date: new Date().toLocaleString(document.documentElement.lang, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) }), false); toast(t('tm.made')); state.snaps.list = null; }
    catch (e) { toast(t('error.generic', { message: e }), true); }
    state.snaps.busy = false; render();
  },
  askRestoreSnap: (d) => { state.dialog = { type: 'restoreSnap', file: d.file, busy: false }; renderOverlay(); },
  restoreSnap: async (d) => {
    const dlg = state.dialog;
    if (state.running.has(state.edit.id)) return toast(t('bk.closeGame'), true);
    dlg.busy = true; renderOverlay();
    try {
      await api.restoreSnapshot(state.edit.id, d.file, t('tm.before'));
      state.dialog = null; toast(t('tm.restored'));
      state.snaps.list = null; state.mods.list = null; state.history.list = null; state.deps.id = null;
      bump('restores');
    } catch (e) { dlg.busy = false; toast(t('error.generic', { message: e }), true); }
    render();
  },
  deleteSnap: async (d) => { try { await api.deleteSnapshot(state.edit.id, d.file); state.snaps.list = null; } catch (e) { toast(t('error.generic', { message: e }), true); } render(); },
  launchAnyway: (d) => { state.dialog = null; renderOverlay(); launch(d.id, true); },
  setInstView: (d) => { state.instView = d.v; render(); },
  openCompare: () => {
    const v = visibleInstances();
    state.dialog = { type: 'compare', a: v[0]?.id, b: v[1]?.id, result: null };
    renderOverlay(); runCompare();
  },

  // ---------- 0.7 ----------
  pickInstance: (d) => {
    const same = state.selectedId === d.id && state.view === 'home';
    const apply = () => { state.selectedId = d.id; if (state.view !== 'home') go('home'); else { lastView = null; render(); } };
    if (same) return apply();
    portal(apply);
  },
  surpriseTheme: () => {
    const n = Math.floor(Math.random() * 900 + 100);
    state.dialog = { type: 'themeEditor', id: '', name: t('dream.name', { n }), ...dreamTheme() };
    applyAppearance(state.settings, state.dialog);
    renderOverlay();
  },
  setRepeat: (d) => { state.settings.musicRepeat = d.v; saveSettings(); render(); },
  setSleep: (d) => {
    const m = Number(d.m);
    state.music.sleep = m === 0 ? null : m === -1 ? { mode: -1 } : { mode: m, until: Date.now() + m * 60000 };
    audio.volume = Math.min(1, (state.settings.musicVolume ?? 70) / 100);
    render();
  },
  toggleFav: (d) => {
    const f = favs();
    if (f.has(d.key)) f.delete(d.key); else f.add(d.key);
    state.settings.musicFav = [...f];
    saveSettings(); render(); checkAchievements();
  },
  toggleMenuMusic: () => { state.settings.menuMusic = !state.settings.menuMusic; saveSettings(); render(); },
  musicPrev: () => prevTrack(),
  openWrapped: () => {
    const year = wrappedYear();
    const data = year && Array.isArray(state.week) ? wrappedData(state.week, year) : null;
    if (!data) return;
    state.wrapped = { slide: 0, data };
    renderOverlay();
  },
  closeWrapped: () => { state.wrapped = null; renderOverlay(); },
  wrappedStep: (d) => { state.wrapped.slide = Math.max(0, state.wrapped.slide + Number(d.d)); renderOverlay(); },

  // ---------- 0.6: аккаунт из Prism ----------
  openPrismAccounts: async () => {
    state.dialog = { type: 'prismAccounts', list: null };
    renderOverlay();
    try { state.dialog.list = await api.findPrismAccounts(); } catch { if (state.dialog) state.dialog.list = []; }
    if (state.dialog?.type === 'prismAccounts') renderOverlay();
  },
  addPrismAccount: async (d) => {
    try {
      state.accounts = await api.addPrismAccount(d.id);
      state.dialog = null;
      state.skins.accountFor = null;
      loadFaces();
      render();
      toast(t('acc.welcome', { name: activeAccount()?.name ?? '' }));
    } catch (e) { toast(String(e) === 'PRISM_GONE' ? t('launch.prismGone') : t('error.generic', { message: e }), true); }
  },
  retryLaunch: (d) => { state.dialog = null; renderOverlay(); launch(d.id); },

  // ---------- 0.6: каталог ----------
  uninstall: async (d) => {
    const r = state.res;
    const target = state.instances.find((i) => i.id === r.targetId) || selected();
    if (!target) return;
    try {
      const removed = await api.removeProject(target.id, d.pid);
      r.installed.delete(d.pid);
      if (state.mods.id === target.id) state.mods.list = null;
      state.deps.id = null;
      toast(t('res.uninstalled', { name: removed[0] || d.title }));
    } catch (e) { toast(t('error.generic', { message: e }), true); }
    refreshResults();
    if (state.dialog?.type === 'project') renderOverlay();
  },
  openProject: async (d) => {
    const r = state.res;
    const kind = d.kind || r.kind;
    const target = state.instances.find((i) => i.id === r.targetId) || selected();
    state.dialog = { type: 'project', id: d.pid, data: null, kind, tab: 'about' };
    renderOverlay();
    try {
      const data = await projectDetails(d.pid, { gameVersion: kind === 'modpack' ? '' : target?.gameVersion, loader: target?.loader, kind });
      if (state.dialog?.type === 'project' && state.dialog.id === d.pid) { state.dialog.data = data; renderOverlay(); }
    } catch { if (state.dialog?.type === 'project') { state.dialog.error = true; renderOverlay(); } }
  },
  setProjectTab: (d) => { state.dialog.tab = d.tab; renderOverlay(); },
  toggleCat: (d) => {
    const c = state.res.cats;
    state.res.cats = c.includes(d.cat) ? c.filter((x) => x !== d.cat) : [...c, d.cat];
    state.res.results = null; render(); runSearch();
  },
  clearCats: () => { state.res.cats = []; state.res.results = null; render(); runSearch(); },

  // ---------- 0.6: моды ----------
  setModView: (d) => { state.modView = d.v; if (d.v === 'history') state.history.list = null; render(); },
  bulkClear: () => { state.modSel = new Set(); render(); },
  bulkMods: async (d) => {
    const files = [...state.modSel];
    const id = state.edit.id;
    let n = 0;
    for (const file of files) {
      const m = state.mods.list.find((x) => x.file === file);
      if (!m) continue;
      try {
        if (d.op === 'delete') { await api.deleteMod(id, file); n++; }
        else if ((d.op === 'enable') !== m.enabled) { await api.toggleMod(id, file); n++; }
      } catch (e) { toast(t('error.generic', { message: e }), true); }
    }
    state.modSel = new Set();
    state.deps.id = null;
    await loadMods(id);
    toast(t('bulk.done', { n }));
  },
  installDep: async (d) => {
    const id = state.edit.id;
    state.res.installing[d.pid] = true; render();
    try {
      const res = await api.installProject(id, d.pid);
      toast(t('res.installedToast', { list: res.installed.join(', ') || d.title }));
      bump('installs');
      state.deps.id = null; state.mods.list = null;
    } catch (e) { toast(t('error.generic', { message: e }), true); }
    delete state.res.installing[d.pid]; render();
  },

  // ---------- 0.6: логи ----------
  reloadLogs: () => { state.logs.data = null; render(); },
  setLogSource: (d) => { state.logs.source = d.v; render(); },
  setLogFilter: (d) => { state.logs.filter = d.v; render(); },
  copyLogs: async () => {
    try { await navigator.clipboard.writeText(currentLogText() || ''); toast(t('launch.copied')); } catch { /* ничего */ }
  },
  openLogsFolder: async () => {
    if (!inApp) return toast(t('common.comingSoon'));
    try { await api.openInstanceFolder(state.edit.id, 'logs'); } catch (e) { toast(t('error.generic', { message: e }), true); }
  },
  crashLogs: (d) => {
    state.dialog = null; renderOverlay();
    actions.openInstance({ id: d.id, tab: 'logs' });
  },

  // ---------- 0.6: новости ----------
  setNewsTab: (d) => { state.news.tab = d.tab; render(); },
  reloadNews: () => { state.news.list = null; render(); },
  openNews: async (d) => {
    const item = state.news.list.find((x) => x.id === d.id);
    if (!item) return;
    if (item.url) return openUrl(item.url);
    state.dialog = { type: 'patch', title: item.title, body: null };
    renderOverlay();
    try { state.dialog.body = await api.patchNoteBody(item.contentPath); } catch { state.dialog.body = item.text; }
    if (state.dialog?.type === 'patch') renderOverlay();
  },
  checkAllUpdates: async () => {
    state.allUpdates = { busy: true, list: null }; render();
    const out = [];
    for (const inst of visibleInstances().filter((i) => i.loader !== 'vanilla')) {
      try {
        const updates = await api.checkModUpdates(inst.id);
        if (updates.length) out.push({ id: inst.id, name: inst.name, updates });
      } catch { /* нет сети — пропустим сборку */ }
    }
    state.allUpdates = { busy: false, list: out }; render();
  },

  // ---------- 0.6: музыка ----------
  setMusicGroup: (d) => { state.music.group = d.g; render(); },
  playTrack: (d) => playTrack(state.music.list.find((x) => x.key === d.key)),
  playAll: () => {
    const list = musicQueue();
    playTrack(state.music.shuffle ? list[Math.floor(Math.random() * list.length)] : list[0]);
  },
  toggleShuffle: () => { state.music.shuffle = !state.music.shuffle; render(); },
  musicToggle: () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); },
  musicNext: () => nextTrack(),
  musicStop: () => { audio.pause(); audio.removeAttribute('src'); state.music.current = null; state.music.playing = false; render(); },

  // ---------- 0.6: мини-режим, Ctrl+K, баг-репорт ----------
  toggleMini: async () => {
    state.mini = !state.mini;
    try { await api.setMini(state.mini); } catch { /* в браузере просто меняем вид */ }
    render(true);
  },
  openPalette: () => {
    state.palette = { query: '', sel: 0 };
    renderOverlay();
    $('#pal-input')?.focus();
  },
  closePalette: () => { state.palette = null; renderOverlay(); },
  palRun: (d) => paletteResults()[Number(d.n)]?.run(),
  openBugReport: () => {
    state.dialog = { type: 'bug', text: '', withLogs: true };
    renderOverlay();
    $('#bug-what')?.focus();
  },
  bugCopy: async () => {
    const text = await bugText();
    try { await navigator.clipboard.writeText(text); toast(t('bug.copied')); state.dialog = null; renderOverlay(); }
    catch { toast(t('error.generic', { message: 'clipboard' }), true); }
  },
  bugGithub: async () => {
    const text = (await bugText()).slice(0, 6000);
    const title = (state.dialog.text || '').split('\n')[0].slice(0, 80) || t('bug.defaultTitle');
    openUrl(`${REPO_URL}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`);
  },

  // ---------- 0.5: датапаки ----------
  installToWorld: async (d) => {
    const dlg = state.dialog;
    if (dlg.busy) return;
    dlg.busy = d.world; renderOverlay();
    try {
      const res = await api.installProject(dlg.target, dlg.pid, d.world);
      state.dialog = null;
      toast(t('dp.installed', { name: res.installed[0] || dlg.title, world: d.world }));
      bump('installs');
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
      if (n) bump('prism', n);
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
      loadFaces();
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
    Object.assign(state.settings, { uiScale: 1, textScale: 1, radiusScale: 1, density: 'normal', depth: 1, pattern: '', glow: 50 });
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
    state.dialog = { type: 'themeEditor', id: '', name: '', bg: cur.bg.startsWith('#') ? cur.bg : '#170B15', accent: cur.accent, text: cur.text,
      bg2: cur.bg2 || '', bgMode: cur.bgMode || 'glow', accent2: cur.accent2 || '', card: '', pattern: '', depth: 1, glow: 50 };
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
    const theme = { id: d.id || 't' + Date.now().toString(36), name: d.name.trim() || t('te.namePlaceholder'), bg: d.bg, accent: d.accent, text: d.text,
      bg2: d.bg2 || '', bgMode: d.bgMode || 'glow', accent2: d.accent2 || '', card: d.card || '', pattern: d.pattern || '', depth: Number(d.depth ?? 1), glow: Number(d.glow ?? 50) };
    const at = list.findIndex((x) => x.id === theme.id);
    if (at >= 0) list[at] = theme; else list.push(theme);
    state.settings.theme = 'custom:' + theme.id;
    state.settings.accent = '';
    state.dialog = null;
    applySettings(); render(); saveSettings();
    toast(t('te.saved', { name: theme.name }));
    checkAchievements();
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
    const json = JSON.stringify({ spectiaTheme: 2, name: d.name, bg: d.bg, accent: d.accent, text: d.text, bg2: d.bg2 || '', bgMode: d.bgMode || 'glow',
      accent2: d.accent2 || '', card: d.card || '', pattern: d.pattern || '', depth: d.depth ?? 1, glow: d.glow ?? 50 }, null, 2);
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
  teSet: (d) => {
    const dlg = state.dialog;
    dlg[d.k] = d.k === 'depth' ? Number(d.v) : d.v;
    if (d.k === 'bgMode' && d.v !== 'solid' && !dlg.bg2) dlg.bg2 = dlg.bg;
    applyAppearance(state.settings, dlg); renderOverlay();
  },
  teToggleGrad: () => {
    const dlg = state.dialog;
    dlg.accent2 = dlg.accent2 ? '' : '#A07CFF';
    applyAppearance(state.settings, dlg); renderOverlay();
  },
  setDepth: (d) => { state.settings.depth = Number(d.v); applySettings(); render(); saveSettings(); },
  setPattern: (d) => { state.settings.pattern = d.v; applySettings(); render(); saveSettings(); },
  testChime: () => chime('ready', (state.settings.soundVolume ?? 60) / 100),
  toggleOn: (d) => {
    // Настройки, которые по умолчанию включены (undefined = включено)
    state.settings[d.key] = state.settings[d.key] === false;
    applySettings(); render(); saveSettings();
  },
  adviseMemory: async () => {
    const id = state.edit?.id; if (!id) return;
    state.memAdvice = { id, loading: true }; render();
    try { state.memAdvice = { id, data: await api.memoryAdvice(id) }; } catch (e) { state.memAdvice = null; toast(t('error.generic', { message: e }), true); }
    render();
  },
  applyMemory: async (d) => {
    const n = Number(d.n); if (!state.edit) return;
    state.edit.memoryGb = n;
    const inst = state.instances.find((i) => i.id === state.edit.id);
    if (inst) { try { await api.updateInstance({ ...inst, memoryGb: n }); await loadInstances(); } catch (e) { toast(t('error.generic', { message: e }), true); } }
    toast(t('mem.applied', { n }));
    render();
  },
  startTour: () => runTour(),
  toggleDownloads: () => toggleDownloads(),
  clearDownloads: () => clearDownloads(),
  setSpeed: (d) => { state.settings.downloadSpeed = d.v; render(); saveSettings(); },
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
  setModSort: (value) => { state.modSort = value; render(); },
  miniSelect: (value) => { state.selectedId = value; render(); },
  cmpA: (value) => { state.dialog.a = value; runCompare(); },
  cmpB: (value) => { state.dialog.b = value; runCompare(); },
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
  if ('seek' in el.dataset) {
    if (audio.duration) audio.currentTime = (Number(el.value) / 1000) * audio.duration;
    el.style.setProperty('--p', Number(el.value) / 10 + '%');
    const p = $('#mu-pos'); if (p) p.textContent = fmtTime(audio.currentTime);
    return;
  }
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
    const lbl = el.parentElement.querySelector('.mono'); if (lbl) lbl.textContent = el.value;
    // Предупредим, если текст плохо читается на фоне
    const low = Math.abs(lumOf(d.text) - lumOf(d.bg)) < 0.4;
    if (low !== !!d.lowContrast) { d.lowContrast = low; renderOverlay(); }
  }
  if ('filterMods' in el.dataset) filterModRows();
  if ('vol' in el.dataset) { audio.volume = Math.min(1, Number(el.value) / 100); el.style.setProperty('--p', el.value + '%'); }
  if ('palette' in el.dataset && state.palette) { state.palette.sel = 0; $('#pal-list').innerHTML = paletteListHtml(); }
  if ('wikiSearch' in el.dataset) { clearTimeout(wikiTimer); wikiTimer = setTimeout(runWikiSearch, 400); }
  if ('logSearch' in el.dataset) { const v = $('#log-view'); if (v) v.innerHTML = logLinesHtml(currentLogText()); }
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
  if (el.dataset.sel !== undefined) {
    if (el.checked) state.modSel.add(el.dataset.sel); else state.modSel.delete(el.dataset.sel);
    render();
    return;
  }
  if ('selall' in el.dataset) {
    state.modSel = el.checked ? new Set((state.mods.list || []).filter((x) => modMatches(x)).map((x) => x.file)) : new Set();
    render();
    return;
  }
  if ('bugLogs' in el.dataset && state.dialog?.type === 'bug') { state.dialog.withLogs = el.checked; return; }
  if (el.id === 'theme-file' && el.files?.[0]) {
    const file = el.files[0];
    file.text().then((text) => {
      const data = JSON.parse(text);
      const ok = (c) => /^#[0-9a-f]{6}$/i.test(c);
      if (!ok(data.bg) || !ok(data.accent) || !ok(data.text)) throw new Error('bad');
      const opt = (c) => (ok(c) ? c : '');
      const theme = { id: 't' + Date.now().toString(36), name: String(data.name || file.name).slice(0, 30), bg: data.bg, accent: data.accent, text: data.text,
        bg2: opt(data.bg2), accent2: opt(data.accent2), card: opt(data.card),
        bgMode: ['solid', 'vertical', 'diagonal', 'glow'].includes(data.bgMode) ? data.bgMode : 'glow',
        pattern: ['', 'dots', 'grid', 'pixels', 'stars'].includes(data.pattern) ? data.pattern : '',
        depth: [0, 1, 2].includes(Number(data.depth)) ? Number(data.depth) : 1,
        glow: Math.max(0, Math.min(100, Number(data.glow ?? 50) || 0)) };
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
    const pack = (p.paths || []).find((f) => /\.(mrpack|zip)$/i.test(f));
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
      toast(t('mods.addedN', { n }));
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
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k' || (ev.ctrlKey && ev.code === 'KeyK')) {
    ev.preventDefault();
    if (state.palette) actions.closePalette(); else if (!state.mini) actions.openPalette();
    return;
  }
  if (state.palette) {
    const n = paletteResults().length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      state.palette.sel = (state.palette.sel + (ev.key === 'ArrowDown' ? 1 : n - 1)) % Math.max(n, 1);
      $('#pal-list').innerHTML = paletteListHtml();
      return;
    }
    if (ev.key === 'Enter') { ev.preventDefault(); paletteResults()[state.palette.sel]?.run(); return; }
    if (ev.key === 'Escape') { actions.closePalette(); return; }
  }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-action][tabindex]')) { ev.preventDefault(); ev.target.click(); return; }
  if (ev.key === 'Escape' && state.ctx) actions.closeCtx();
  else if (ev.key === 'Escape' && state.dialog) actions.closeDialog();
});

// ---------- Запуск ----------

const startedAt = performance.now();

const TOUR_STEPS = [
  { target: null, title: 'tour.welcome', text: 'tour.welcomeText', lang: true },
  { target: '#sidebar', title: 'tour.instances', text: 'tour.instancesText' },
  { target: '.hero .play', title: 'tour.play', text: 'tour.playText' },
  { target: '.rail-btn[data-view="resources"]', title: 'tour.catalog', text: 'tour.catalogText' },
  { target: '#dlbtn', title: 'tour.downloads', text: 'tour.downloadsText' },
  { target: '.searchbox', title: 'tour.search', text: 'tour.searchText' },
  { target: '.rail-face', title: 'tour.profile', text: 'tour.profileText' },
  { target: '.rail-btn[data-view="settings"]', title: 'tour.settings', text: 'tour.settingsText' },
  { target: null, title: 'tour.done', text: 'tour.doneText' },
];

function runTour() {
  state.dialog = null; renderOverlay();
  if (state.view !== 'home') { state.view = 'home'; render(); }
  startTour({
    steps: TOUR_STEPS, t, esc, langs: LANGS,
    lang: () => state.settings.language,
    onLang: (code) => { state.settings.language = code; applySettings(); render(); saveSettings(); },
    onDone: () => { if (!state.settings.tourDone) { state.settings.tourDone = true; saveSettings(); } },
  });
}

/** Самый первый запуск: подбираем язык по языку системы */
function firstRunLanguage() {
  if (state.settings.tourDone || state.instances.length || state.accounts?.accounts?.length) return;
  for (const l of navigator.languages || [navigator.language]) {
    const code = String(l || '').toLowerCase().split('-')[0];
    if (LANGS[code]) {
      if (code !== state.settings.language) { state.settings.language = code; applySettings(); saveSettings(); }
      return;
    }
  }
}

async function init() {
  try {
    state.settings = await api.getSettings();
  } catch {
    state.settings = { theme: 'sakura', language: 'ru', reduceMotion: false, hideOnLaunch: true, checkUpdates: true, autoJava: true, curseforgeKey: '' };
  }
  applySettings();
  initDownloads({ t, esc, nameOf: (id) => state.instances.find((i) => i.id === id)?.name, mode: () => state.settings.downloadSpeed });
  subscribe();
  try { await loadInstances(); } catch (e) { toast(t('error.generic', { message: e }), true); }
  try { state.dataDir = await api.dataDir(); } catch { /* без обложек тоже можно */ }
  try { state.accounts = await api.listAccounts(); } catch { /* без аккаунтов тоже можно жить */ }
  try { state.running = new Set(await api.runningInstances()); } catch { /* ничего */ }
  try { state.msReady = await api.microsoftReady(); } catch { /* старый бэкенд */ }
  firstRunLanguage();
  loadFaces();
  setTimeout(checkAchievements, 2000);
  if (!state.settings.tourDone) setTimeout(() => { if (!state.dialog) runTour(); }, 1500);
  if (state.settings.menuMusic) startMenuMusic();
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
