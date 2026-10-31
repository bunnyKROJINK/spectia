// Иконки в виде SVG-строк. Все рисуются линией текущего цвета текста (currentColor).
const s = (size, body, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icon = {
  moon: (n = 20) => s(n, '<path d="M12 3a7 7 0 1 0 9 9 9 9 0 1 1-9-9z"/><path d="M17 4l.6 1.4L19 6l-1.4.6L17 8l-.6-1.4L15 6l1.4-.6z"/>'),
  gear: (n = 20) => s(n, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  play: (n = 16) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>`,
  back: (n = 18) => s(n, '<path d="M15 18l-6-6 6-6"/>', 'stroke-width="2"'),
  chevronRight: (n = 16) => s(n, '<path d="M9 18l6-6-6-6"/>', 'stroke-width="2"'),
  chevronDown: (n = 18) => s(n, '<path d="M6 9l6 6 6-6"/>', 'stroke-width="2"'),
  folder: (n = 18) => s(n, '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  upload: (n = 34) => s(n, '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>', 'stroke-width="1.6"'),
  search: (n = 34) => s(n, '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>', 'stroke-width="1.6"'),
  copy: (n = 16) => s(n, '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  edit: (n = 16) => s(n, '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  palette: (n = 16) => s(n, '<path d="M12 21a9 9 0 1 1 9-9c0 2.5-2 3.5-4 3.5h-1.5a1.5 1.5 0 0 0-1 2.6c.6.6.4 2.9-2.5 2.9z"/><circle cx="7.5" cy="11" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="11" r="1"/>'),
  trash: (n = 16) => s(n, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  warn: (n = 20) => s(n, '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 'stroke-width="2"'),
  box: (n = 34) => s(n, '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', 'stroke-width="1.6"'),
  minimize: () => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" stroke="currentColor" stroke-width="1"/></svg>',
  maximize: () => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  close: () => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1"/></svg>',
  microsoft: () => '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9.5" height="9.5" fill="#F25022"/><rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00"/><rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900"/></svg>',
  star: (n = 18) => s(n, '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>'),
  archive: (n = 16) => s(n, '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
  tag: (n = 16) => s(n, '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/>'),
  bell: (n = 18) => s(n, '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  image: (n = 18) => s(n, '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  move: (n = 16) => s(n, '<path d="M4 12h13M13 7l5 5-5 5"/><path d="M4 5v14"/>'),
  restore: (n = 16) => s(n, '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  note: (n = 16) => s(n, '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>'),
  sparkle: (n = 16) => s(n, '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z"/>'),
  music: (n = 20) => s(n, '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  skin: (n = 20) => s(n, '<rect x="8" y="3" width="8" height="7"/><rect x="7" y="10" width="10" height="7"/><path d="M9 17v4M15 17v4"/>'),
  news: (n = 20) => s(n, '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  trophy: (n = 18) => s(n, '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6v4H9z"/>'),
  heart: (n = 16) => s(n, '<path d="M12 20s-7-4.4-9-9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c-2 4.6-9 9-9 9z"/>', 'stroke-width="2"'),
  shuffle: (n = 16) => s(n, '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>', 'stroke-width="2"'),
  repeat: (n = 16) => s(n, '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', 'stroke-width="2"'),
  moonSleep: (n = 16) => s(n, '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>'),
  volume: (n = 16) => s(n, '<path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7"/>', 'stroke-width="2"'),
  prev: (n = 16) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>`,
  next: (n = 16) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>`,
  pause: (n = 16) => `<svg width="${n}" height="${n}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`,
};

/** Ночной пейзаж для большой карточки на главной. */
export const heroArt = `<svg viewBox="0 0 1000 280" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <circle cx="820" cy="70" r="34" fill="#F4F1FF" opacity="0.9"/>
  <circle cx="808" cy="62" r="34" fill="rgba(20,16,50,0.55)"/>
  <g fill="#FFFFFF" opacity="0.75"><rect x="120" y="40" width="3" height="3"/><rect x="260" y="80" width="2" height="2"/><rect x="420" y="30" width="3" height="3"/><rect x="560" y="70" width="2" height="2"/><rect x="680" y="24" width="2" height="2"/><rect x="930" y="120" width="3" height="3"/><rect x="40" y="110" width="2" height="2"/></g>
  <path d="M0 210 h80 v-20 h80 v-30 h80 v20 h80 v-40 h80 v30 h80 v-20 h80 v40 h80 v-30 h80 v20 h80 v-10 h120 V280 H0z" fill="rgba(10,10,30,0.55)"/>
  <path d="M0 240 h120 v-20 h100 v10 h120 v-30 h100 v20 h140 v-10 h120 v20 h140 v-10 h160 V280 H0z" fill="rgba(6,6,20,0.8)"/>
</svg>`;

// ---------- Пиксельные картинки сборок ----------
// Палитры для шести цветов обложки (как TINTS): небо, трава, земля, листва, акцент
const SCENES = [
  ['#183A60', '#2E5B34', '#5A3E28', '#244F28', '#F2E3A1'],
  ['#3A2A4A', '#5A3B5A', '#3A2618', '#7A3A5A', '#F2C1E0'],
  ['#163C3A', '#2D6B4E', '#3E2E1E', '#1E4D3A', '#BFF2D5'],
  ['#2A1420', '#5A2630', '#2A1A14', '#7A2E3B', '#F2A0A0'],
  ['#3A2A14', '#7A6A2E', '#5A3E1E', '#A8792E', '#FFE9A8'],
  ['#14223F', '#2E4A7A', '#2A2A3A', '#3E5FA0', '#CFE0FF'],
];

/** Маленький значок сборки 4×4 пикселя */
export function tintIcon(n = 0) {
  const [sky, grass, dirt, leaf, acc] = SCENES[n % SCENES.length];
  return `<svg viewBox="0 0 4 4" shape-rendering="crispEdges" aria-hidden="true"><rect width="4" height="4" fill="${sky}"/><rect y="2" width="4" height="2" fill="${dirt}"/><rect y="2" width="4" height="1" fill="${grass}"/><rect x="1" width="2" height="2" fill="${leaf}"/><rect x="3" width="1" height="1" fill="${acc}"/></svg>`;
}

/** Пиксельный пейзаж для большой обложки сборки */
export function pixelScene(n = 0) {
  const [sky, grass, dirt, leaf, acc] = SCENES[n % SCENES.length];
  return `<svg class="scene" viewBox="0 0 64 24" preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" aria-hidden="true">
    <rect width="64" height="24" fill="${sky}"/><rect y="6" width="64" height="4" fill="${sky}" opacity=".8"/>
    <rect x="50" y="3" width="3" height="3" fill="${acc}"/><rect x="12" y="4" width="5" height="1" fill="#DCE6F5" opacity=".7"/><rect x="30" y="6" width="7" height="1" fill="#DCE6F5" opacity=".6"/>
    <rect y="15" width="64" height="9" fill="${grass}"/><rect y="15" width="64" height="1" fill="${leaf}"/><rect y="18" width="64" height="6" fill="${dirt}"/>
    <rect x="4" y="9" width="5" height="5" fill="${leaf}"/><rect x="6" y="14" width="1" height="1" fill="${dirt}"/>
    <rect x="40" y="10" width="4" height="4" fill="${leaf}"/><rect x="41" y="14" width="1" height="1" fill="${dirt}"/>
    <rect x="22" y="11" width="7" height="4" fill="#9A7A50"/><rect x="21" y="10" width="9" height="1" fill="#7A3434"/><rect x="25" y="13" width="2" height="2" fill="#3A2818"/>
  </svg>`;
}
