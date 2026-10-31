// Плавающие украшения тематических тем: планеты, рыбки, тыквы…
// Всё нарисовано векторной графикой прямо здесь, без картинок и эмодзи.
// Украшения полупрозрачные, медленно покачиваются и никогда не мешают кликать.

const SHAPES = {
  space: [
    (c) => `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="11" fill="${c[0]}"/><ellipse cx="24" cy="24" rx="21" ry="6" fill="none" stroke="${c[1]}" stroke-width="2.5" transform="rotate(-20 24 24)"/><circle cx="20" cy="20" r="3" fill="#fff" opacity=".25"/></svg>`,
    (c) => `<svg viewBox="0 0 24 24"><path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z" fill="${c[2]}"/></svg>`,
    (c) => `<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="14" fill="${c[1]}"/><circle cx="18" cy="20" r="3" fill="#000" opacity=".18"/><circle cx="29" cy="29" r="4" fill="#000" opacity=".15"/><circle cx="28" cy="16" r="2" fill="#000" opacity=".15"/></svg>`,
    (c) => `<svg viewBox="0 0 60 24"><path d="M2 20 L46 8" stroke="${c[2]}" stroke-width="2" stroke-linecap="round" opacity=".6"/><circle cx="50" cy="7" r="5" fill="${c[2]}"/></svg>`,
  ],
  ocean: [
    (c) => `<svg viewBox="0 0 48 28"><ellipse cx="20" cy="14" rx="16" ry="9" fill="${c[0]}"/><path d="M34 14l12-9v18z" fill="${c[0]}"/><circle cx="11" cy="11" r="2" fill="#03131a"/><path d="M18 6q4 8 0 16" stroke="#fff" stroke-width="1.5" fill="none" opacity=".35"/></svg>`,
    (c) => `<svg viewBox="0 0 48 28"><ellipse cx="22" cy="14" rx="14" ry="10" fill="${c[1]}"/><path d="M34 14l12-8v16z" fill="${c[1]}"/><path d="M20 4l6 -3v6z" fill="${c[1]}"/><circle cx="13" cy="11" r="2" fill="#03131a"/></svg>`,
    (c) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${c[2]}" stroke-width="1.8"/><circle cx="8.5" cy="8.5" r="2" fill="${c[2]}" opacity=".7"/></svg>`,
    (c) => `<svg viewBox="0 0 24 48"><path d="M12 48 C4 38 20 30 12 20 C6 12 16 6 12 0" stroke="${c[3]}" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`,
  ],
  halloween: [
    (c) => `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="9.5" ry="8" fill="${c[0]}"/><ellipse cx="12" cy="14" rx="3.6" ry="8" fill="${c[1]}"/><rect x="11" y="3" width="2" height="5" rx="1" fill="#5C8A2E"/><path d="M8 13l2 -2 1 2zM13 13l2 -2 1 2z M8 17q4 3 8 0" stroke="#2a1405" stroke-width="1" fill="#2a1405" opacity=".55"/></svg>`,
    (c) => `<svg viewBox="0 0 24 12"><path d="M12 4c1-2 2-2 2-2l.5 2 3-1.5c1.5 2 4 2 6.5 1-1.5 2-3 4-6 4.5-1.5-1-3.5-.5-4 1.5-.5-2-2.5-2.5-4-1.5-3-.5-4.5-2.5-6-4.5 2.5 1 5 1 6.5-1l3 1.5.5-2s1 0 2 2z" fill="${c[2]}"/></svg>`,
    (c) => `<svg viewBox="0 0 24 28"><path d="M3 26V12a9 9 0 0 1 18 0v14l-3-3-3 3-3-3-3 3-3-3z" fill="${c[3]}"/><circle cx="9" cy="12" r="1.6" fill="#140b06"/><circle cx="15" cy="12" r="1.6" fill="#140b06"/></svg>`,
  ],
};

const COLORS = {
  space: ['#8A7CFF', '#C08BFF', '#FFFFFF'],
  ocean: ['#FF9E5E', '#5FE0F0', '#BDF4FF', '#2FB58A'],
  halloween: ['#FF8A2B', '#E86F12', '#F4E9FF', '#F4F0FF'],
};

/** Повторяемый «случайный» генератор: украшения не прыгают при каждой перерисовке. */
function rng(seed) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

export function renderDecorations(kind, enabled) {
  const layer = document.getElementById('deco');
  if (!layer) return;
  if (!enabled || !SHAPES[kind]) {
    layer.innerHTML = '';
    layer.dataset.kind = '';
    return;
  }
  if (layer.dataset.kind === kind) return; // уже нарисовано
  layer.dataset.kind = kind;
  const rand = rng(kind.length * 7919 + 17);
  const shapes = SHAPES[kind];
  const colors = COLORS[kind];
  let html = '';
  // Сетка 6×5 с небольшим смещением — равномерно, но не по линейке
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) {
      if (rand() < 0.15) continue;
      const shape = shapes[Math.floor(rand() * shapes.length)];
      // Водоросли — только снизу
      const isWeed = kind === 'ocean' && shape === shapes[3];
      if (isWeed && row < 4) continue;
      const size = 22 + Math.round(rand() * (isWeed ? 34 : 30));
      const left = col * 16.6 + 1 + rand() * 12;
      const top = isWeed ? 86 + rand() * 6 : row * 19.5 + 2 + rand() * 13;
      const dur = (5 + rand() * 5).toFixed(1);
      const delay = (-rand() * 8).toFixed(1);
      const op = (0.2 + rand() * 0.16).toFixed(2);
      const flip = kind === 'ocean' && rand() < 0.5 ? 'scaleX(-1)' : '';
      html += `<span class="deco-item ${isWeed ? 'sway' : ''}" style="left:${left}%;top:${top}%;width:${size}px;opacity:${op};animation-duration:${dur}s;animation-delay:${delay}s;--flip:${flip || 'none'}">${shape(colors)}</span>`;
    }
  }
  layer.innerHTML = html;
}
