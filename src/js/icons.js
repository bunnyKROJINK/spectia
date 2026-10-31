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
  trash: (n = 16) => s(n, '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  warn: (n = 20) => s(n, '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>', 'stroke-width="2"'),
  box: (n = 34) => s(n, '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', 'stroke-width="1.6"'),
  minimize: () => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6h10" stroke="currentColor" stroke-width="1"/></svg>',
  maximize: () => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  close: () => '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1"/></svg>',
  microsoft: () => '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9.5" height="9.5" fill="#F25022"/><rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00"/><rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900"/></svg>',
};

/** Ночной пейзаж для большой карточки на главной. */
export const heroArt = `<svg viewBox="0 0 1000 280" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <circle cx="820" cy="70" r="34" fill="#F4F1FF" opacity="0.9"/>
  <circle cx="808" cy="62" r="34" fill="rgba(20,16,50,0.55)"/>
  <g fill="#FFFFFF" opacity="0.75"><rect x="120" y="40" width="3" height="3"/><rect x="260" y="80" width="2" height="2"/><rect x="420" y="30" width="3" height="3"/><rect x="560" y="70" width="2" height="2"/><rect x="680" y="24" width="2" height="2"/><rect x="930" y="120" width="3" height="3"/><rect x="40" y="110" width="2" height="2"/></g>
  <path d="M0 210 h80 v-20 h80 v-30 h80 v20 h80 v-40 h80 v30 h80 v-20 h80 v40 h80 v-30 h80 v20 h80 v-10 h120 V280 H0z" fill="rgba(10,10,30,0.55)"/>
  <path d="M0 240 h120 v-20 h100 v10 h120 v-30 h100 v20 h140 v-10 h120 v20 h140 v-10 h160 V280 H0z" fill="rgba(6,6,20,0.8)"/>
</svg>`;
