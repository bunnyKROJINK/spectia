// Окно «Загрузки», как в Steam: что качается сейчас, живой график скорости,
// сколько осталось и что уже скачалось сегодня.
// Скорость присылает Rust раз в полсекунды (событие net-stats),
// этапы — обычное событие launch-progress.

const SAMPLES = 72;          // 36 секунд истории на графике
const HISTORY_KEY = 'spectia.dlHistory';
const COUNTED = new Set(['java', 'libraries', 'assets']);

let ctx = null;              // { t, esc, nameOf, mode }
const samples = new Array(SAMPLES).fill(0);
let peak = 0;
let lastBytes = 0;           // всего байт с запуска лаунчера (по данным Rust)
let sessionStart = null;     // сколько байт было, когда лаунчер впервые что-то качал
let speed = 0;
let active = 0;
let open = false;
const jobs = new Map();      // id сборки → { stage, done, total, startBytes, startTime, stageStart }

export function initDownloads(c) {
  ctx = c;
  const panel = document.createElement('div');
  panel.id = 'dlpanel';
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;
  document.body.appendChild(panel);
  document.addEventListener('mousedown', (ev) => {
    if (!open) return;
    if (ev.target.closest('#dlpanel') || ev.target.closest('#dlbtn')) return;
    toggleDownloads(false);
  });
  document.addEventListener('keydown', (ev) => { if (open && ev.key === 'Escape') toggleDownloads(false); });
}

// ---------- Данные ----------

export function onNetStats(s) {
  if (sessionStart === null && s.bytes > 0) sessionStart = s.bytes - (s.speed / 2);
  lastBytes = s.bytes;
  speed = s.speed;
  active = s.active;
  samples.push(speed);
  samples.shift();
  peak = Math.max(peak, speed);
  refresh();
}

export function onLaunchProgress(p) {
  let job = jobs.get(p.instanceId);
  if (!job) {
    job = { startBytes: lastBytes, startTime: Date.now(), stage: '', stageStart: Date.now() };
    jobs.set(p.instanceId, job);
  }
  if (job.stage !== p.stage) { job.stage = p.stage; job.stageStart = Date.now(); job.stageFrom = p.done; }
  job.done = p.done;
  job.total = p.total;
  if (p.stage === 'starting') finish(p.instanceId, true);
  refresh();
}

/** Сборка запустилась, закрылась или запуск не удался */
export function finish(id, ok = true) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  const bytes = Math.max(0, lastBytes - job.startBytes);
  // В историю попадают только настоящие загрузки, а не запуск «всё уже скачано»
  if (ok && bytes > 256 * 1024) {
    const h = readHistory();
    h.items.unshift({ name: ctx?.nameOf(id) || 'Minecraft', bytes, seconds: Math.round((Date.now() - job.startTime) / 1000), at: Date.now() });
    h.items = h.items.slice(0, 30);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* не страшно */ }
  }
  refresh();
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function readHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null');
    if (h && h.date === today() && Array.isArray(h.items)) return h;
  } catch { /* ничего */ }
  return { date: today(), items: [] };
}

export function clearDownloads() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ничего */ }
  refresh();
}

export function isDownloading() {
  return jobs.size > 0 || active > 0;
}

// ---------- Оформление ----------

export function formatSize(b) {
  const t = ctx.t;
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' ' + t('unit.gb');
  if (b >= 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' ' + t('dl.mb');
  return Math.max(0, Math.round(b / 1024)) + ' ' + t('dl.kb');
}

const formatSpeed = (b) => formatSize(b) + '/' + ctx.t('dl.s');

function formatTime(sec) {
  const t = ctx.t;
  sec = Math.max(1, Math.round(sec));
  if (sec < 60) return t('dl.sec', { n: sec });
  return t('dl.min', { n: Math.round(sec / 60) });
}

/** Общий прогресс всех подготовок: 0…1, либо null, если этап без счётчика */
function overall() {
  let done = 0; let total = 0;
  for (const j of jobs.values()) {
    if (COUNTED.has(j.stage) && j.total > 1) { done += j.done; total += j.total; }
  }
  return total ? done / total : null;
}

export function dlButtonHtml() {
  if (!ctx) return '';
  const { t, esc } = ctx;
  const busy = isDownloading();
  const frac = overall();
  const R = 11; const C = 2 * Math.PI * R;
  const ring = busy
    ? `<svg class="dl-ring ${frac === null ? 'spin' : ''}" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="${R}" fill="none" stroke="var(--line)" stroke-width="2.4"/>
        <circle cx="14" cy="14" r="${R}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"
          stroke-dasharray="${frac === null ? C * 0.28 : C * Math.max(0.02, frac)} ${C}" transform="rotate(-90 14 14)"/>
      </svg>`
    : '';
  const label = busy ? `${t('dl.open')}: ${formatSpeed(speed)}` : t('dl.open');
  return `<button id="dlbtn" class="dlbtn ${busy ? 'busy' : ''}" data-action="toggleDownloads" aria-expanded="${open}" aria-label="${esc(label)}" title="${esc(label)}">
    ${ring}
    <svg class="dl-arrow" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v7.5M3.6 6 7 9.4 10.4 6M2 12.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    ${busy ? `<span class="dl-speed">${esc(formatSpeed(speed))}</span>` : ''}
  </button>`;
}

function graph() {
  const W = 320; const H = 92;
  const top = Math.max(peak, 512 * 1024) * 1.12;
  const x = (i) => (i / (SAMPLES - 1)) * W;
  const y = (v) => H - (v / top) * (H - 6);
  const pts = samples.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const peakY = y(peak).toFixed(1);
  return `<svg class="dl-graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${ctx.esc(ctx.t('dl.now') + ': ' + formatSpeed(speed))}">
    <defs><linearGradient id="dlg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity=".55"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}
    ${peak > 0 ? `<line x1="0" x2="${W}" y1="${peakY}" y2="${peakY}" stroke="var(--accent2, var(--accent))" stroke-dasharray="4 4" stroke-width="1" opacity=".7" vector-effect="non-scaling-stroke"/>` : ''}
    <polygon points="0,${H} ${pts} ${W},${H}" fill="url(#dlg)"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function jobRow(id, j) {
  const { t, esc } = ctx;
  const counted = COUNTED.has(j.stage) && j.total > 1;
  const pct = counted ? Math.round((j.done / j.total) * 100) : 0;
  let eta = '';
  if (counted && j.done > (j.stageFrom || 0)) {
    const passed = (Date.now() - j.stageStart) / 1000;
    const rate = (j.done - (j.stageFrom || 0)) / Math.max(passed, 0.5);
    const left = (j.total - j.done) / Math.max(rate, 0.01);
    eta = left < 3 ? t('dl.etaSoon') : t('dl.eta', { time: formatTime(left) });
  }
  const got = Math.max(0, lastBytes - j.startBytes);
  return `<div class="dl-job">
    <div class="row between"><b class="dl-name">${esc(ctx.nameOf(id) || 'Minecraft')}</b><span class="small muted">${esc(formatSize(got))}</span></div>
    <div class="small">${esc(t('launch.stage.' + j.stage))}${counted ? ' · ' + esc(t('dl.files', { done: j.done, total: j.total })) : ''}</div>
    <div class="bar"><span style="width:${counted ? pct : 100}%" class="${counted ? '' : 'indeterminate'}"></span></div>
    ${eta ? `<div class="small muted">${esc(eta)}</div>` : ''}
  </div>`;
}

function panelHtml() {
  const { t, esc } = ctx;
  const busy = isDownloading();
  const hist = readHistory().items;
  const session = sessionStart === null ? 0 : lastBytes - sessionStart;
  const jobsHtml = [...jobs.entries()].map(([id, j]) => jobRow(id, j)).join('');
  const other = !jobs.size && active > 0
    ? `<div class="dl-job"><b class="dl-name">${esc(t('dl.other'))}</b><div class="bar"><span style="width:100%" class="indeterminate"></span></div></div>` : '';
  return `
    <div class="row between dl-head">
      <h2 class="h2">${esc(t('dl.title'))}</h2>
      <span class="small muted">${esc(t('dl.mode', { mode: t('set.speed.' + (ctx.mode() || 'normal')) }))}</span>
    </div>
    <div class="dl-stats">
      <div><span class="small muted">${esc(t('dl.now'))}</span><b>${esc(formatSpeed(busy ? speed : 0))}</b></div>
      <div><span class="small muted">${esc(t('dl.peak'))}</span><b>${esc(formatSpeed(peak))}</b></div>
      <div><span class="small muted">${esc(t('dl.total'))}</span><b>${esc(formatSize(session))}</b></div>
    </div>
    ${graph()}
    ${jobsHtml || other || `<div class="dl-empty"><b>${esc(t('dl.idle'))}</b><span class="small muted">${esc(t('dl.idleSub'))}</span></div>`}
    <div class="row between dl-head" style="margin-top:6px">
      <span class="label">${esc(t('dl.today'))}</span>
      ${hist.length ? `<button class="btn ghost" style="height:28px;padding:0 10px;font-size:12px" data-action="clearDownloads">${esc(t('dl.clear'))}</button>` : ''}
    </div>
    ${hist.length ? `<ul class="dl-hist">${hist.map((h) => `<li>
        <span class="dl-check" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6.3 5 8.6l4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="grow dl-name">${esc(h.name)}</span>
        <span class="small muted">${esc(t('dl.took', { size: formatSize(h.bytes), time: formatTime(h.seconds) }))}</span>
        <span class="small muted">${esc(new Date(h.at).toLocaleTimeString(document.documentElement.lang, { hour: '2-digit', minute: '2-digit' }))}</span>
      </li>`).join('')}</ul>` : `<span class="small muted">${esc(t('dl.todayEmpty'))}</span>`}`;
}

export function toggleDownloads(force) {
  open = typeof force === 'boolean' ? force : !open;
  const panel = document.getElementById('dlpanel');
  if (!panel) return;
  panel.hidden = !open;
  if (open) {
    const btn = document.getElementById('dlbtn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      panel.style.top = r.bottom + 8 + 'px';
      panel.style.right = Math.max(8, window.innerWidth - r.right - 60) + 'px';
    }
  }
  refresh();
}

function refresh() {
  if (!ctx) return;
  const btn = document.getElementById('dlbtn');
  if (btn) {
    const holder = document.createElement('div');
    holder.innerHTML = dlButtonHtml();
    btn.replaceWith(holder.firstElementChild);
  }
  const panel = document.getElementById('dlpanel');
  if (panel && open) panel.innerHTML = panelHtml();
}
