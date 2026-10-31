// Знакомство с лаунчером: подсвечиваем части окна по очереди и коротко рассказываем,
// что где лежит. Показывается при первом запуске, повторить можно в настройках.

let ctx = null;   // { steps, t, esc, langs, lang, onLang, onDone }
let index = 0;
let root = null;

export function startTour(c) {
  ctx = c;
  index = 0;
  if (!root) {
    root = document.createElement('div');
    root.id = 'tour';
    document.body.appendChild(root);
    window.addEventListener('resize', () => { if (ctx) draw(); });
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('click', onClick);
    root.addEventListener('change', (ev) => {
      if (ev.target.matches('[data-tour-lang]')) { ctx.onLang(ev.target.value); draw(); }
    });
  }
  root.hidden = false;
  draw();
  root.querySelector('.tour-card [data-tour="next"]')?.focus();
}

export function tourActive() {
  return !!(root && !root.hidden);
}

function finish() {
  if (!root) return;
  root.hidden = true;
  root.innerHTML = '';
  const done = ctx?.onDone;
  ctx = null;
  done?.();
}

function onKey(ev) {
  if (!tourActive()) return;
  if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); finish(); }
  else if (ev.key === 'ArrowRight' && !ev.target.matches('select')) { ev.preventDefault(); go(1); }
  else if (ev.key === 'ArrowLeft' && !ev.target.matches('select')) { ev.preventDefault(); go(-1); }
}

function onClick(ev) {
  const b = ev.target.closest('[data-tour]');
  if (!b) return;
  const what = b.dataset.tour;
  if (what === 'next') go(1);
  else if (what === 'back') go(-1);
  else if (what === 'skip') finish();
}

function go(d) {
  const steps = visibleSteps();
  index += d;
  if (index >= steps.length) return finish();
  index = Math.max(0, index);
  draw();
  root.querySelector('.tour-card [data-tour="next"]')?.focus();
}

/** Шаги, у которых есть что подсветить (или которые показываются по центру) */
function visibleSteps() {
  return ctx.steps.filter((s) => !s.target || document.querySelector(s.target));
}

function draw() {
  if (!ctx || !root) return;
  const { t, esc } = ctx;
  const steps = visibleSteps();
  const step = steps[Math.min(index, steps.length - 1)];
  const el = step.target ? document.querySelector(step.target) : null;
  const pad = 6;
  const r = el ? el.getBoundingClientRect() : null;
  const last = index === steps.length - 1;

  const langPick = step.lang
    ? `<label class="tour-lang"><span class="small muted">${esc(t('set.language'))}</span>
        <select class="input" data-tour-lang>${Object.entries(ctx.langs).map(([code, d]) => `<option value="${code}" ${code === ctx.lang() ? 'selected' : ''}>${esc(d['lang.name'])}</option>`).join('')}</select></label>`
    : '';
  root.innerHTML = `
    ${r ? `<div class="tour-spot" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>`
        : '<div class="tour-dim"></div>'}
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      ${step.art ? `<div class="tour-art" aria-hidden="true">${step.art}</div>` : ''}
      <span class="small muted">${esc(t('tour.step', { n: index + 1, all: steps.length }))}</span>
      <h2 class="h2" id="tour-title">${esc(t(step.title))}</h2>
      <p class="tour-text">${esc(t(step.text))}</p>
      ${langPick}
      <div class="tour-dots" aria-hidden="true">${steps.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</div>
      <div class="row between" style="gap:8px">
        ${last ? '<span></span>' : `<button class="btn ghost" data-tour="skip">${esc(t('tour.skip'))}</button>`}
        <div class="row" style="gap:8px">
          ${index > 0 ? `<button class="btn" data-tour="back">${esc(t('common.back'))}</button>` : ''}
          <button class="btn accent" data-tour="next">${esc(t(last ? 'tour.finish' : index === 0 ? 'tour.start' : 'tour.next'))}</button>
        </div>
      </div>
    </div>`;

  // Ставим карточку рядом с подсвеченным местом, чтобы она его не закрывала
  const card = root.querySelector('.tour-card');
  const cw = card.offsetWidth; const ch = card.offsetHeight;
  const W = window.innerWidth; const H = window.innerHeight; const gap = 16;
  let x; let y;
  if (!r) { x = (W - cw) / 2; y = (H - ch) / 2; }
  else if (r.right + gap + cw < W - 8) { x = r.right + gap; y = r.top; }
  else if (r.bottom + gap + ch < H - 8) { x = r.left; y = r.bottom + gap; }
  else if (r.left - gap - cw > 8) { x = r.left - gap - cw; y = r.top; }
  else { x = r.left; y = r.top - gap - ch; }
  card.style.left = Math.round(Math.min(Math.max(8, x), W - cw - 8)) + 'px';
  card.style.top = Math.round(Math.min(Math.max(8, y), H - ch - 8)) + 'px';
}
