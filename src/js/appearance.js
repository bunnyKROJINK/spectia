// Внешний вид: свои темы, акцентный цвет, фон-картинка, масштаб, размер текста,
// скругление углов и плотность. Всё это — надстройка над обычными темами из themes.js.

import { THEMES, applyTheme } from './themes.js';
import { fileUrl, inApp } from './api.js';

// ---------- Цвета ----------

const hex = (h) => {
  const s = String(h || '').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
};
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;
const mix = (a, b, k) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * k));
/** Яркость 0…1 — чтобы понять, светлый цвет или тёмный */
export const lum = (h) => { const [r, g, b] = hex(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/** Цвета акцента, выведенные из одного цвета */
function accentVars(accent, bg) {
  const light = lum(bg) > 0.5;
  return {
    accent,
    accentInk: lum(accent) > 0.55 ? mix(bg, '#000000', light ? 0.9 : 0.4) : '#FFFFFF',
    accentSoft: rgba(accent, light ? 0.12 : 0.17),
    accentText: light ? mix(accent, '#000000', 0.35) : mix(accent, '#FFFFFF', 0.55),
    glow: rgba(accent, 0.34),
  };
}

/** Делает полную тему из трёх цветов редактора: фон, акцент, текст. */
export function themeFromColors({ bg, accent, text }) {
  const light = lum(bg) > 0.5;
  const base = light ? THEMES.light : THEMES.night;
  return {
    ...base,
    scheme: light ? 'light' : 'dark',
    bg,
    dialog: light ? '#FFFFFF' : mix(bg, '#FFFFFF', 0.07),
    g1: rgba(accent, light ? 0.18 : 0.26),
    g2: rgba(mix(accent, '#3080FF', 0.5), light ? 0.14 : 0.2),
    text,
    muted: mix(text, bg, 0.3),
    navText: mix(text, bg, 0.16),
    navOn: text,
    avatar: `linear-gradient(135deg,${mix(accent, '#000000', 0.25)},${mix(accent, '#3080FF', 0.45)})`,
    ...accentVars(accent, bg),
  };
}

/** Тема по id: обычная или своя (custom:…) */
export function resolveTheme(settings) {
  const id = settings.theme || 'sakura';
  if (id.startsWith('custom:')) {
    const c = (settings.customThemes || []).find((x) => 'custom:' + x.id === id);
    if (c) return themeFromColors(c);
  }
  return THEMES[id] || THEMES.sakura;
}

// ---------- Применение ----------

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function applyAppearance(settings, preview = null) {
  const root = document.documentElement;
  const theme = preview ? themeFromColors(preview) : resolveTheme(settings);
  applyTheme('sakura'); // сбрасываем переменные к полному набору
  for (const [key, value] of Object.entries(theme)) {
    if (key !== 'scheme' && key !== 'deco') root.style.setProperty('--' + kebab(key), value);
  }
  root.style.colorScheme = theme.scheme;

  // Свой акцент поверх темы
  if (!preview && settings.accent) {
    for (const [key, value] of Object.entries(accentVars(settings.accent, theme.bg))) root.style.setProperty('--' + kebab(key), value);
  }

  // Размер текста, скругления, плотность
  root.style.setProperty('--fs', String(settings.textScale || 1));
  root.style.setProperty('--rs', String(settings.radiusScale ?? 1));
  root.style.setProperty('--ds', String(settings.density === 'compact' ? 0.75 : settings.density === 'roomy' ? 1.2 : 1));

  // Фон-картинка
  const bg = settings.background;
  const layer = document.getElementById('bgimg');
  if (layer) {
    const url = bg?.path ? (inApp ? fileUrl(bg.path) : bg.path) : '';
    document.body.classList.toggle('has-bg', !!url);
    layer.style.backgroundImage = url ? `url("${url}")` : '';
    layer.style.setProperty('--bg-blur', (bg?.blur ?? 8) + 'px');
    layer.style.setProperty('--bg-dim', String((bg?.dim ?? 65) / 100));
  }
  return theme;
}

/** Масштаб всего интерфейса (как Ctrl + колёсико в браузере) */
export function applyZoom(scale) {
  const z = Number(scale) || 1;
  const web = window.__TAURI__?.webview?.getCurrentWebview?.();
  if (web?.setZoom) web.setZoom(z).catch(() => { document.body.style.zoom = z; });
  else document.body.style.zoom = z;
}
