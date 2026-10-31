import { t } from './i18n.js';
// Аксолотль в уголке лаунчера и аквариум на главной.
// Рисунки свои (не из Minecraft): пиксельные, в духе игры.

const AX = { b: '#7FA8FF', d: '#4A6FD8', l: '#BCD3FF', g: '#5A7BE0', e: '#141A2E', m: '#3A55B8' };
// Аксолотль смотрит вправо, 16×10 пикселей. Каждая строка — 16 символов.
const AXOLOTL = [
  '...........g.g..',
  '.........g.g.g.g',
  '.........gbbbbb.',
  'll.....bbbbbbbbb',
  'lbbbbbbbbbbbbebb',
  'lbbbbbbbbbbbbbbb',
  'll..bbbbbbbbbmmb',
  '....lllllllbbbb.',
  '.....d...d......',
  '................',
];

function pixels(rows, pal) {
  let out = '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${pal[ch]}"/>`; }));
  return out;
}

const axolotlSvg = `<svg viewBox="0 0 16 10" width="64" height="40" shape-rendering="crispEdges">${pixels(AXOLOTL, AX)}</svg>`;

let el = null;
let x = 40;
let facing = 1;
let timer = null;
let mood = 'idle';
let enabled = false;

function place() {
  if (!el) return;
  el.style.setProperty('--x', x + 'px');
  el.style.setProperty('--flip', String(facing));
}

function wander() {
  if (!enabled || mood === 'sleep') return;
  const target = 10 + Math.random() * 200;
  facing = target < x ? -1 : 1;
  x = target;
  place();
}

function nightNow() {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

function updateMood(running) {
  const next = running ? 'happy' : nightNow() ? 'sleep' : 'idle';
  if (next === mood) return;
  mood = next;
  el?.setAttribute('data-mood', mood);
}

export function setPet(on, { running = false } = {}) {
  enabled = !!on;
  if (!el) {
    el = document.getElementById('pet');
    if (!el) return;
    el.innerHTML = `<button class="pet-body" type="button" aria-label="${t('pet.label')}">${axolotlSvg}</button><span class="pet-fx" aria-hidden="true"></span>`;
    el.querySelector('.pet-body').addEventListener('click', () => {
      el.classList.remove('spin');
      void el.offsetWidth;
      el.classList.add('spin');
      const fx = el.querySelector('.pet-fx');
      const heart = '<svg viewBox="0 0 5 4" width="12" height="10" shape-rendering="crispEdges"><rect x="0" y="0" width="2" height="2" fill="#FF8CC6"/><rect x="3" y="0" width="2" height="2" fill="#FF8CC6"/><rect x="0" y="1" width="5" height="2" fill="#FF8CC6"/><rect x="1" y="3" width="3" height="1" fill="#FF8CC6"/></svg>';
      fx.innerHTML = `<i>${heart}</i><i>${heart}</i><i>${heart}</i>`;
      setTimeout(() => { el.classList.remove('spin'); fx.innerHTML = ''; }, 1200);
    });
  }
  el.hidden = !enabled;
  if (!enabled) { clearInterval(timer); timer = null; return; }
  updateMood(running);
  place();
  if (!timer) timer = setInterval(() => { updateMood(document.body.classList.contains('game-running')); wander(); }, 5000);
}

export function petMood(running) {
  document.body.classList.toggle('game-running', !!running);
  if (enabled) updateMood(running);
}

// ---------- Аквариум ----------

const FISH = [
  ['#FF9A3C', '#FFD08A'], ['#4FD8E8', '#B4F0F7'], ['#FF8CC6', '#FFC2E0'], ['#FFD166', '#FFF0B8'], ['#7FA8FF', '#C9DAFF'], ['#4ADE9A', '#B6F5D6'],
];
const fishSvg = ([c, l]) => `<svg viewBox="0 0 8 5" width="40" height="25" shape-rendering="crispEdges"><rect x="0" y="1" width="1" height="3" fill="${c}"/><rect x="1" y="2" width="1" height="1" fill="${c}"/><rect x="2" y="1" width="5" height="3" fill="${c}"/><rect x="3" y="0" width="3" height="1" fill="${c}"/><rect x="3" y="3" width="3" height="1" fill="${l}"/><rect x="6" y="1" width="1" height="1" fill="#141A2E"/><rect x="7" y="2" width="1" height="1" fill="${c}"/></svg>`;

export function setAquarium(on) {
  const box = document.getElementById('aquarium');
  if (!box) return;
  box.hidden = !on;
  if (on && !box.childElementCount) {
    box.innerHTML = Array.from({ length: 9 }, (_, n) => {
      const dir = n % 2 ? 'left' : 'right';
      return `<span class="fish ${dir}" style="top:${8 + ((n * 37) % 80)}%;animation-duration:${18 + ((n * 7) % 16)}s;animation-delay:-${(n * 5.3).toFixed(1)}s">${fishSvg(FISH[n % FISH.length])}</span>`;
    }).join('') + Array.from({ length: 10 }, (_, n) => `<i class="bubble" style="left:${(n * 11 + 4) % 100}%;animation-delay:-${n * 1.7}s;animation-duration:${8 + (n % 5)}s"></i>`).join('');
  }
}
