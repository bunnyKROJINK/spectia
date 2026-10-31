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

/**
 * Делает полную тему из цветов редактора. Обязательны фон, акцент и текст;
 * остальное — по желанию: второй цвет фона и вид градиента, второй цвет акцента,
 * цвет карточек, узор, объём и свечение.
 */
export function themeFromColors(t) {
  const { bg, accent, text } = t;
  const light = lum(bg) > 0.5;
  const base = light ? THEMES.light : THEMES.night;
  return {
    ...base,
    scheme: light ? 'light' : 'dark',
    bg,
    dialog: light ? '#FFFFFF' : mix(t.card || bg, '#FFFFFF', 0.06),
    g1: rgba(accent, light ? 0.18 : 0.26),
    g2: rgba(t.accent2 || mix(accent, '#3080FF', 0.5), light ? 0.14 : 0.2),
    text,
    muted: mix(text, bg, 0.3),
    navText: mix(text, bg, 0.16),
    navOn: text,
    avatar: `linear-gradient(135deg,${mix(accent, '#000000', 0.25)},${mix(t.accent2 || accent, '#3080FF', 0.45)})`,
    ...accentVars(accent, bg),
    accent2: t.accent2 || '',
    bg2: t.bg2 || '',
    bgMode: t.bgMode || 'glow',
    card: t.card || '',
    pattern: t.pattern,
    depth: t.depth,
    glowLevel: t.glow,
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

// ---------- Узоры на фоне ----------

function patternCss(kind, light) {
  const ink = light ? 'rgba(20,24,60,.07)' : 'rgba(255,255,255,.045)';
  switch (kind) {
    case 'dots': return `radial-gradient(${ink} 1.2px, transparent 1.4px) 0 0 / 18px 18px`;
    case 'grid': return `linear-gradient(${ink} 1px, transparent 1px) 0 0 / 28px 28px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0 / 28px 28px`;
    case 'pixels': return `linear-gradient(45deg, ${ink} 25%, transparent 25%, transparent 75%, ${ink} 75%) 0 0 / 16px 16px, linear-gradient(45deg, ${ink} 25%, transparent 25%, transparent 75%, ${ink} 75%) 8px 8px / 16px 16px`;
    case 'stars': {
      const st = light ? 'rgba(20,24,60,.12)' : 'rgba(255,255,255,.35)';
      return [[13, 21], [71, 9], [42, 63], [88, 47], [27, 86], [60, 32], [5, 55], [80, 80]]
        .map(([x, y], n) => `radial-gradient(${n % 3 ? 1 : 1.5}px ${n % 3 ? 1 : 1.5}px at ${x}% ${y}%, ${st}, transparent)`)
        .join(', ');
    }
    default: return '';
  }
}

// ---------- Применение ----------

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

export function applyAppearance(settings, preview = null) {
  const root = document.documentElement;
  const theme = preview ? themeFromColors(preview) : resolveTheme(settings);
  applyTheme('sakura'); // сбрасываем переменные к полному набору
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value === 'string' && !['scheme', 'deco', 'accent2', 'bg2', 'bgMode', 'card', 'pattern'].includes(key)) root.style.setProperty('--' + kebab(key), value);
  }
  root.style.colorScheme = theme.scheme;

  // Свой акцент поверх темы
  let accent = theme.accent;
  if (!preview && settings.accent) {
    accent = settings.accent;
    for (const [key, value] of Object.entries(accentVars(settings.accent, theme.bg))) root.style.setProperty('--' + kebab(key), value);
  }
  const light = theme.scheme === 'light';
  const bg = theme.bg;

  // «Верстак»: слои фона, карточки, линии — всё выводится из цвета фона темы
  const card = theme.card || (light ? '#FFFFFF' : mix(bg, '#FFFFFF', 0.055));
  const tokens = {
    bg0: light ? mix(bg, '#000000', 0.07) : mix(bg, '#000000', 0.42),
    bg1: light ? mix(bg, '#000000', 0.035) : mix(bg, '#000000', 0.2),
    card,
    card2: light ? mix(bg, '#FFFFFF', 0.55) : mix(card, '#FFFFFF', 0.05),
    line: light ? mix(bg, '#000000', 0.1) : mix(bg, '#FFFFFF', 0.09),
    accentDeep: mix(accent, '#000000', 0.35),
  };
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty('--' + kebab(k), v);

  // Градиент акцента (кнопка «Играть», переключатели, полоски)
  const accent2 = (!settings.accent || preview) && theme.accent2 ? theme.accent2 : '';
  root.style.setProperty('--accent-fill', accent2 ? `linear-gradient(135deg, ${accent}, ${accent2})` : accent);

  // Объём: 0 — плоско, 1 — обычно, 2 — «блоки»
  const depth = Number(theme.depth ?? settings.depth ?? 1);
  const hi = light ? 0.7 : [0, 0.06, 0.1][depth] ?? 0.06;
  const lo = light ? [0, 0.12, 0.2][depth] ?? 0.12 : [0, 0.35, 0.55][depth] ?? 0.35;
  const drop = [0, 2, 3][depth] ?? 2;
  root.style.setProperty('--raise', depth ? `inset 0 1px 0 rgba(255,255,255,${hi}), 0 ${drop}px 0 rgba(0,0,0,${lo})` : `0 0 0 1px ${tokens.line}`);
  root.style.setProperty('--raise-big', depth ? `inset 0 1px 0 rgba(255,255,255,${hi}), 0 ${drop}px 0 rgba(0,0,0,${lo}), 0 ${8 * depth}px ${18 * depth}px rgba(0,0,0,${light ? 0.08 : 0.28})` : `0 0 0 1px ${tokens.line}`);
  root.style.setProperty('--sunk', depth ? `inset 0 1px 2px rgba(0,0,0,${light ? 0.12 : 0.45})` : `inset 0 0 0 1px ${tokens.line}`);
  root.style.setProperty('--btn-edge', depth ? `inset 0 2px 0 rgba(255,255,255,.3), inset 0 -${drop + 1}px 0 ${tokens.accentDeep}, 0 ${drop}px 0 rgba(0,0,0,${lo})` : 'none');

  // Свечение кнопки «Играть»: 0…100
  const glow = Number(theme.glowLevel ?? settings.glow ?? 50) / 100;
  root.style.setProperty('--play-glow', glow > 0 ? `0 10px ${Math.round(14 + glow * 24)}px ${rgba(accent, (0.12 + glow * 0.4).toFixed(2))}` : '0 0 0 transparent');

  // Фон окна: градиент темы + узор
  const mode = theme.bgMode || 'glow';
  const bg2 = theme.bg2 || mix(bg, accent, 0.18);
  let fill;
  if (mode === 'vertical') fill = `linear-gradient(180deg, ${bg}, ${bg2})`;
  else if (mode === 'diagonal') fill = `linear-gradient(135deg, ${bg}, ${bg2})`;
  else if (mode === 'solid') fill = bg;
  else fill = `radial-gradient(1200px 600px at 85% -10%, ${theme.g1}, transparent 60%), radial-gradient(900px 500px at -10% 110%, ${theme.g2}, transparent 60%), ${theme.bg2 ? `linear-gradient(160deg, ${bg}, ${theme.bg2})` : bg}`;
  const pattern = patternCss(theme.pattern ?? settings.pattern, light);
  root.style.setProperty('--app-fill', pattern ? `${pattern}, ${fill}` : fill);

  // Размер текста, скругления, плотность
  root.style.setProperty('--fs', String(settings.textScale || 1));
  root.style.setProperty('--rs', String(settings.radiusScale ?? 1));
  root.style.setProperty('--ds', String(settings.density === 'compact' ? 0.75 : settings.density === 'roomy' ? 1.2 : 1));

  // Фон-картинка
  const bgImg = settings.background;
  const layer = document.getElementById('bgimg');
  if (layer) {
    const url = bgImg?.path ? (inApp ? fileUrl(bgImg.path) : bgImg.path) : '';
    const video = /\.(mp4|webm)$/i.test(bgImg?.path || '');
    document.body.classList.toggle('has-bg', !!url);
    layer.style.backgroundImage = url && !video ? `url("${url}")` : '';
    // Живые обои: видео без звука, по кругу
    const old = layer.querySelector('video');
    if (video && url) {
      if (!old || old.dataset.src !== url) {
        layer.innerHTML = `<video autoplay muted loop playsinline data-src="${url.replace(/"/g, '&quot;')}" src="${url.replace(/"/g, '&quot;')}"></video>`;
      }
    } else if (old) {
      layer.innerHTML = '';
    }
    layer.style.setProperty('--bg-blur', (bgImg?.blur ?? 8) + 'px');
    layer.style.setProperty('--bg-dim', String((bgImg?.dim ?? 65) / 100));
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
