// Spectia — главный файл интерфейса.
//
// Как это устроено:
//  • Всё, что видно на экране, описано в объекте `state`.
//  • Функции view* превращают state в HTML.
//  • Кнопки помечены data-action="…", а их обработчики лежат в объекте `actions`.
//  • Поля ввода помечены data-bind="путь.в.state" и сами записывают туда значение.

import { api, win, openUrl, inApp } from './api.js';
import { t, setLang, LANGS, formatNumber } from './i18n.js';
import { THEMES, THEME_ORDER, TINTS, applyTheme } from './themes.js';
import { icon, heroArt } from './icons.js';
import { searchModrinth } from './modrinth.js';

const APP_VERSION = '0.1.0';
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
  create: { mode: 'scratch', name: '', version: '', loader: 'fabric', tint: 0, snapshots: false },
  edit: null,              // копия сборки, которую сейчас настраиваем
  advOpen: false,
  res: { query: '', kind: 'mod', source: 'modrinth', results: null, loading: false, error: false, targetId: null },
  skins: { model: 'classic', selected: 0 },
  dialog: null,
  toast: null,
  launching: false,
};

// ---------- Маленькие помощники ----------

const $ = (sel) => document.querySelector(sel);

/** Экранирует текст, чтобы название вроде <b> не сломало страницу. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const selected = () => state.instances.find((i) => i.id === state.selectedId) || state.instances[0] || null;
const loaderLabel = (id) => (id === 'vanilla' ? t('loader.none') : t('loader.' + id));
const tint = (n) => TINTS[n] || TINTS[0];
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
  applyTheme(state.settings.theme);
  document.documentElement.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
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
    <section class="hero" aria-label="${esc(cur.name)}" style="background:${tint(cur.tint)}">${heroArt}
      <div class="hero-inner">
        <div class="stack" style="gap:10px;min-width:0">
          <span class="eyebrow">${esc(t('home.continue'))}</span>
          <h1 class="ellipsis">${esc(cur.name)}</h1>
          <div class="row" style="gap:8px">
            <span class="chip">Minecraft ${esc(cur.gameVersion)}</span>
            <span class="chip">${esc(loaderLabel(cur.loader))}</span>
            <span class="chip">${esc(t('home.ram', { gb: cur.memoryGb }))}</span>
          </div>
        </div>
        <div class="row">
          <button class="icon-btn" data-action="openInstance" data-id="${esc(cur.id)}" aria-label="${esc(t('home.instanceSettings'))}" title="${esc(t('home.instanceSettings'))}">${icon.gear()}</button>
          <button class="play" data-action="play">${icon.play()}<span>${esc(t(state.launching ? 'home.launching' : 'home.play'))}</span></button>
        </div>
      </div>
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
        ${state.instances.slice(0, 8).map((i) => `
          <button class="card" data-action="select" data-id="${esc(i.id)}" ${pressed(i.id === cur.id)}>
            <span class="cover" style="background:${tint(i.tint)}"></span>
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

function viewInstances() {
  const rows = state.instances.map((i) => `
    <div class="list-row">
      <span class="thumb" style="background:${tint(i.tint)}"></span>
      <div class="stack grow" style="gap:3px">
        <span class="card-title ellipsis">${esc(i.name)}</span>
        <span class="small muted">Minecraft ${esc(i.gameVersion)} · ${esc(loaderLabel(i.loader))} · ${esc(t('home.ram', { gb: i.memoryGb }))}</span>
      </div>
      <div class="row" style="gap:8px">
        <button class="icon-btn" data-action="openInstance" data-id="${esc(i.id)}" aria-label="${esc(t('home.instanceSettings'))}" title="${esc(t('home.instanceSettings'))}">${icon.gear(18)}</button>
        <button class="icon-btn" data-action="openFolder" data-id="${esc(i.id)}" aria-label="${esc(t('inst.openFolder'))}" title="${esc(t('inst.openFolder'))}">${icon.folder()}</button>
        <button class="btn accent" style="height:40px" data-action="playInstance" data-id="${esc(i.id)}">${esc(t('inst.play'))}</button>
      </div>
    </div>`).join('');

  return `<div class="view">
    <div class="row between">
      <h1 class="page-title">${esc(t('inst.title'))}</h1>
      <div class="row" style="gap:8px">
        <button class="btn" data-action="soon">${esc(t('inst.import'))}</button>
        <button class="btn" data-action="soon">${esc(t('inst.export'))}</button>
        <button class="btn accent" data-action="openCreate">${esc(t('home.newInstance'))}</button>
      </div>
    </div>
    ${state.instances.length
      ? `<section class="panel list">${rows}</section>`
      : `<section class="panel empty">${icon.box()}<h2 class="h2">${esc(t('inst.empty'))}</h2>
           <button class="btn accent" data-action="openCreate">${esc(t('home.newInstance'))}</button></section>`}
  </div>`;
}

function versionOptions() {
  const c = state.create;
  if (state.versionsError) {
    return `<div class="row"><span class="warn">${esc(t('create.versionsError'))}</span>
      <button class="btn sm" data-action="retryVersions">${esc(t('create.retry'))}</button></div>`;
  }
  if (!state.versions) return `<div class="row"><span class="spinner"></span><span class="muted">${esc(t('common.loading'))}</span></div>`;
  const list = state.versions.versions.filter((v) => v.kind === 'release' || (c.snapshots && v.kind === 'snapshot'));
  return `<label for="ver" class="sr">${esc(t('create.version'))}</label>
    <select id="ver" class="input" style="flex:1 1 220px" data-bind="create.version">
      ${list.map((v) => `<option value="${esc(v.id)}" ${v.id === c.version ? 'selected' : ''}>${esc(v.id === state.versions.latest.release ? t('create.latest', { id: v.id }) : v.id)}</option>`).join('')}
    </select>`;
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
          ${TINTS.map((g, n) => `<button class="tint-btn" style="background:${g}" data-action="setTint" data-n="${n}" ${pressed(n === c.tint)} aria-label="${esc(t('create.coverN', { n: n + 1 }))}"></button>`).join('')}
        </div>
      </div>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('create.version'))}</h2>
      <div class="row">
        ${versionOptions()}
        <button class="row" role="switch" aria-checked="${c.snapshots}" data-action="toggleSnapshots" style="gap:10px;min-height:44px;border:0;background:transparent;cursor:pointer">
          <span class="switch"></span><span>${esc(t('create.snapshots'))}</span>
        </button>
      </div>
    </section>

    <section class="panel pad stack" style="gap:12px">
      <h2 class="h2">${esc(t('create.loader'))}</h2>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px" role="group" aria-label="${esc(t('create.loader'))}">
        ${LOADERS.map((l) => `<button class="card loader-card" data-action="setLoader" data-loader="${l}" ${pressed(l === c.loader)}>
          <span class="card-title">${esc(t('loader.' + l))}</span>
          <span class="small muted" style="line-height:1.4">${esc(t('loader.' + l + '.hint'))}</span>
        </button>`).join('')}
      </div>
      ${c.loader !== 'vanilla' ? `<div class="field" style="max-width:360px">
        <label for="lver" class="label">${esc(t('create.loaderVersion'))}</label>
        <select id="lver" class="input"><option>${esc(t('create.loaderRecommended'))}</option></select>
      </div>` : ''}
    </section>`;

  const importMode = `
    <div class="grid grid-2">
      <section class="panel dashed empty" style="min-height:220px">${icon.upload()}
        <h2 class="h2">${esc(t('create.dropTitle'))}</h2>
        <p class="note">${esc(t('create.dropSub'))}</p>
        <button class="btn" data-action="soon">${esc(t('common.chooseFile'))}</button>
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
  const input = (id, key, type = 'text', placeholder = '', extra = '') =>
    `<input id="${id}" class="input" type="${type}" placeholder="${esc(placeholder)}" value="${esc(e[key])}" data-bind="edit.${key}" ${extra}>`;

  return `<div class="view">
    <div class="row" style="gap:14px">
      <button class="icon-btn" data-action="goBack" aria-label="${esc(t('common.back'))}">${icon.back()}</button>
      <span class="thumb" style="width:44px;height:44px;background:${tint(e.tint)}"></span>
      <div class="stack" style="gap:2px">
        <span class="small muted">${esc(t('is.title'))}</span>
        <h1 style="font-size:24px;font-weight:700">${esc(e.name)}</h1>
      </div>
    </div>

    <section class="panel pad stack" style="gap:12px">
      <div class="row between" style="align-items:baseline">
        <h2 class="h2">${esc(t('is.memory'))}</h2>
        <span id="mem-label" style="font-size:22px;font-weight:700;color:var(--accent-text)">${e.memoryGb} ${esc(t('unit.gb'))}</span>
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
    </section>

    <div class="row between">
      <button class="btn" data-action="askDelete" data-id="${esc(e.id)}" style="color:var(--warn-text)">${icon.trash()}<span>${esc(t('is.delete'))}</span></button>
      <div class="row">
        <button class="btn" data-action="resetEdit">${esc(t('common.reset'))}</button>
        <button class="btn accent" data-action="saveInstance">${esc(t('common.save'))}</button>
      </div>
    </div>
  </div>`;
}

function viewResources() {
  const r = state.res;
  const target = state.instances.find((i) => i.id === r.targetId) || selected();
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
            <h2 class="h2" style="font-size:15px">${esc(m.title)}</h2>
            <span class="badge">Modrinth</span>
          </div>
          <span class="small muted">${esc(t('res.by', { author: m.author }))} · ${esc(t('res.downloads', { n: formatNumber(m.downloads) }))}</span>
          <p class="note" style="line-height:1.45">${esc(m.description)}</p>
          <a href="#" class="small" data-action="openUrl" data-url="${esc(m.url)}">modrinth.com</a>
        </div>
        <button class="btn sm soft" data-action="soon">${esc(t('res.install'))}</button>
      </article>`).join('')}
    </div>`;
  }

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
    ${results}
  </div>`;
}

const SKINS = [
  { shirt: '#6A5ACD', dark: '#4B3FA0', eye: '#3B5BDB' },
  { shirt: '#2D9B6E', dark: '#1F6E4E', eye: '#2D7A5E' },
  { shirt: '#D9579A', dark: '#A33D72', eye: '#8A4FD1' },
  { shirt: '#C93A4A', dark: '#912A36', eye: '#5A3A2A' },
  { shirt: '#E0A63A', dark: '#A8792E', eye: '#3B5BDB' },
];

function skinSvg(k, slim) {
  const arm = slim ? 3 : 4;
  return `<svg width="160" height="320" viewBox="0 0 16 32" shape-rendering="crispEdges" role="img" aria-label="${esc(t('skins.preview'))}">
    <rect x="4" y="0" width="8" height="8" fill="#C8A07A"/><rect x="4" y="0" width="8" height="2" fill="#3B2A22"/>
    <rect x="4" y="2" width="1" height="2" fill="#3B2A22"/><rect x="11" y="2" width="1" height="2" fill="#3B2A22"/>
    <rect x="5" y="4" width="2" height="1" fill="#fff"/><rect x="6" y="4" width="1" height="1" fill="${k.eye}"/>
    <rect x="9" y="4" width="2" height="1" fill="#fff"/><rect x="9" y="4" width="1" height="1" fill="${k.eye}"/>
    <rect x="7" y="6" width="2" height="1" fill="#A97E5C"/>
    <rect x="4" y="8" width="8" height="12" fill="${k.shirt}"/><rect x="7" y="8" width="2" height="3" fill="${k.dark}"/>
    <rect x="${4 - arm}" y="8" width="${arm}" height="12" fill="${k.dark}"/><rect x="12" y="8" width="${arm}" height="12" fill="${k.dark}"/>
    <rect x="${4 - arm}" y="17" width="${arm}" height="3" fill="#C8A07A"/><rect x="12" y="17" width="${arm}" height="3" fill="#C8A07A"/>
    <rect x="4" y="20" width="4" height="12" fill="#2C3354"/><rect x="8" y="20" width="4" height="12" fill="#262C4A"/>
    <rect x="4" y="30" width="8" height="2" fill="#1A1D2E"/>
  </svg>`;
}

function viewSkins() {
  const sk = state.skins;
  return `<div class="view">
    <h1 class="page-title">${esc(t('skins.title'))}</h1>
    <div class="row" style="gap:16px;align-items:stretch">
      <section class="panel pad stack" style="flex:1 1 280px;align-items:center;gap:16px">
        <div style="width:100%;display:flex;justify-content:center;padding:16px 0;border-radius:12px;background:radial-gradient(160px 120px at 50% 60%,var(--accent-soft),transparent 70%)">
          ${skinSvg(SKINS[sk.selected], sk.model === 'slim')}
        </div>
        <div class="seg" role="group" aria-label="${esc(t('skins.model'))}">
          <button data-action="setModel" data-model="classic" ${pressed(sk.model === 'classic')}>${esc(t('skins.classic'))}</button>
          <button data-action="setModel" data-model="slim" ${pressed(sk.model === 'slim')}>${esc(t('skins.slim'))}</button>
        </div>
      </section>
      <div class="stack" style="flex:999 1 380px;gap:16px">
        <section class="panel dashed empty">${icon.upload(32)}
          <h2 class="h2">${esc(t('skins.upload'))}</h2>
          <p class="note">${esc(t('skins.uploadSub'))}</p>
          <button class="btn" data-action="soon">${esc(t('common.chooseFile'))}</button>
        </section>
        <section class="panel pad stack" style="gap:12px">
          <h2 class="h2">${esc(t('skins.mine'))}</h2>
          <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:10px">
            ${SKINS.map((k, n) => `<button class="card" style="align-items:center;gap:0;padding:12px 0" data-action="setSkin" data-n="${n}" ${pressed(n === sk.selected)} aria-label="${esc(t('skins.n', { n: n + 1 }))}">
              <span style="display:block;width:22px;height:22px;background:#C8A07A;box-shadow:inset 0 6px 0 #3B2A22"></span>
              <span style="display:block;width:22px;height:30px;background:${k.shirt}"></span>
            </button>`).join('')}
          </div>
        </section>
      </div>
    </div>
  </div>`;
}

function viewAccounts() {
  return `<div class="view">
    <h1 class="page-title">${esc(t('acc.title'))}</h1>
    <section class="panel empty"><h2 class="h2">${esc(t('acc.none'))}</h2><p class="note">${esc(t('acc.noneSub'))}</p></section>
    <h2 class="h2" style="margin:8px 0 0 4px">${esc(t('acc.add'))}</h2>
    <div class="grid grid-2">
      <section class="panel pad stack">
        ${icon.microsoft()}
        <h3 class="h2">${esc(t('acc.ms'))}</h3>
        <p class="note">${esc(t('acc.msText'))}</p>
        <button class="btn accent" style="align-self:flex-start" data-action="soon">${esc(t('acc.msBtn'))}</button>
      </section>
      <section class="panel pad stack">
        <span class="avatar" style="width:28px;height:28px;border-radius:6px;font-size:14px;background:#207E5C">E</span>
        <h3 class="h2">${esc(t('acc.ely'))}</h3>
        <p class="note">${esc(t('acc.elyText'))}</p>
        <button class="btn" style="align-self:flex-start" data-action="soon">${esc(t('acc.elyBtn'))}</button>
      </section>
    </div>
  </div>`;
}

function viewSettings() {
  const s = state.settings;
  const themeCards = THEME_ORDER.map((id) => {
    const T = THEMES[id];
    return `<button class="card theme-card" data-action="setTheme" data-theme="${id}" ${pressed(id === s.theme)}>
      <span class="theme-preview" style="border:1px solid ${T.border};background:radial-gradient(120px 60px at 90% 0%,${T.g1},transparent 70%),${T.bg}">
        <span class="side" style="background:${T.surface};border-right:1px solid ${T.border}"></span>
        <span class="main"><span class="hero-mini" style="background:${T.surface2}"></span><span class="btn-mini" style="background:${T.accent}"></span></span>
      </span>
      <span style="font-weight:600">${esc(t('theme.' + id))}</span>
    </button>`;
  }).join('');

  return `<div class="view">
    <h1 class="page-title">${esc(t('set.title'))}</h1>
    <section class="panel pad stack" style="gap:14px">
      <div class="stack" style="gap:2px">
        <h2 class="h2">${esc(t('set.theme'))}</h2>
        <span class="note">${esc(t('set.themeNow', { name: t('theme.' + s.theme) }))}</span>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))" role="group" aria-label="${esc(t('set.theme'))}">${themeCards}</div>
      ${switchRow('toggleSetting', 'reduceMotion', s.reduceMotion, t('set.reduceMotion'), t('set.reduceMotionSub'))}
    </section>

    <div class="grid grid-2">
      <section class="panel pad stack">
        <h2 class="h2">${esc(t('set.general'))}</h2>
        <label for="lang" class="label">${esc(t('set.language'))}</label>
        <select id="lang" class="input" data-change="setLanguage">
          ${Object.entries(LANGS).map(([code, dict]) => `<option value="${code}" ${code === s.language ? 'selected' : ''}>${esc(dict['lang.name'])}</option>`).join('')}
        </select>
      </section>
      <section class="panel pad stack" style="gap:4px">
        <h2 class="h2" style="margin-bottom:6px">${esc(t('set.behavior'))}</h2>
        ${switchRow('toggleSetting', 'hideOnLaunch', s.hideOnLaunch, t('set.hideOnLaunch'))}
        ${switchRow('toggleSetting', 'checkUpdates', s.checkUpdates, t('set.checkUpdates'))}
        ${switchRow('toggleSetting', 'autoJava', s.autoJava, t('set.autoJava'))}
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
    </div>
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
        <span class="avatar">?</span>
        <span class="stack grow" style="gap:2px"><span style="font-weight:600">${esc(t('acc.notSigned'))}</span><span class="small muted">Microsoft · Ely.by</span></span>
        ${icon.chevronRight()}
      </button>
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
  renderOverlay();
}

// ---------- Поиск ----------

let searchTimer;
let searchSeq = 0;
async function runSearch() {
  const r = state.res;
  if (r.source !== 'modrinth') return;
  const target = state.instances.find((i) => i.id === r.targetId) || selected();
  const seq = ++searchSeq;
  r.loading = true; r.error = false;
  if (state.view === 'resources') render();
  try {
    const results = await searchModrinth({ query: r.query, kind: r.kind, gameVersion: target?.gameVersion, loader: target?.loader });
    if (seq !== searchSeq) return; // пришёл ответ на старый запрос — пропускаем
    r.results = results;
  } catch {
    if (seq !== searchSeq) return;
    r.error = true;
  }
  r.loading = false;
  if (state.view === 'resources') render();
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

  select: (d) => { state.selectedId = d.id; state.launching = false; render(); },
  play: () => toast(t('home.playSoon')),
  playInstance: (d) => { state.selectedId = d.id; go('home'); toast(t('home.playSoon')); },
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
  setLoader: (d) => { state.create.loader = d.loader; render(); },
  toggleSnapshots: () => { state.create.snapshots = !state.create.snapshots; render(); },
  retryVersions: () => { state.versionsError = false; render(); loadVersions(); },
  catalogModpacks: () => { state.res.kind = 'modpack'; state.res.results = null; go('resources'); runSearch(); },
  createInstance: async () => {
    const c = state.create;
    try {
      const inst = await api.createInstance({ name: c.name.trim(), gameVersion: c.version, loader: c.loader, tint: c.tint });
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
    go('instance');
  },
  toggleEdit: (d) => { state.edit[d.key] = !state.edit[d.key]; render(); },
  toggleAdv: () => { state.advOpen = !state.advOpen; render(); },
  resetEdit: () => {
    const inst = state.instances.find((i) => i.id === state.edit.id);
    if (inst) { state.edit = structuredClone(inst); render(); }
  },
  saveInstance: async () => {
    try {
      await api.updateInstance(state.edit);
      await loadInstances();
      toast(t('common.saved'));
      go(state.back === 'instance' ? 'home' : state.back);
    } catch (e) {
      toast(t('error.generic', { message: e }), true);
    }
  },
  askDelete: (d) => { state.dialog = { type: 'confirmDelete', id: d.id }; renderOverlay(); },
  closeDialog: () => { state.dialog = null; renderOverlay(); },
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

  setKind: (d) => { state.res.kind = d.kind; state.res.results = null; runSearch(); render(); },
  setSource: (d) => { state.res.source = d.source; render(); if (d.source === 'modrinth' && !state.res.results) runSearch(); },
  search: () => runSearch(),

  setModel: (d) => { state.skins.model = d.model; render(); },
  setSkin: (d) => { state.skins.selected = Number(d.n); render(); },

  setTheme: (d) => { state.settings.theme = d.theme; applySettings(); render(); saveSettings(); },
  toggleSetting: (d) => {
    state.settings[d.key] = !state.settings[d.key];
    applySettings(); render(); saveSettings();
  },
};

// Что делать при выборе в выпадающем списке (data-change="…")
const changes = {
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
  const value = 'number' in el.dataset ? Number(el.value) : el.value;
  setPath(el.dataset.bind, value);
  if (el.id === 'mem') $('#mem-label').textContent = value + ' ' + t('unit.gb');
  if ('search' in el.dataset) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 350);
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.change) changes[el.dataset.change]?.(el.value);
  if (el.dataset.bind && el.tagName === 'SELECT') setPath(el.dataset.bind, el.value);
  if ('saveSettings' in el.dataset) saveSettings();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && state.dialog) actions.closeDialog();
});

// ---------- Запуск ----------

async function init() {
  try {
    state.settings = await api.getSettings();
  } catch {
    state.settings = { theme: 'sakura', language: 'ru', reduceMotion: false, hideOnLaunch: true, checkUpdates: true, autoJava: true, curseforgeKey: '' };
  }
  applySettings();
  try { await loadInstances(); } catch (e) { toast(t('error.generic', { message: e }), true); }
  render();
  document.body.classList.add('ready');
  loadVersions(); // заранее, чтобы экран «Новая сборка» открывался мгновенно
}

init();
