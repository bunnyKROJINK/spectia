// Достижения Spectia — в духе подписей из Minecraft: коротко и по делу.
// Каждое достижение проверяется по тому, что лаунчер уже знает: сессии игры,
// сборки, установки, темы, музыка. Ничего никуда не отправляется.

/** icon — пиксельная картинка 8×8: строка из 64 символов, каждый — цвет из палитры */
const P = { '.': '', k: '#1C1C1C', g: '#4E9A3A', G: '#2E6B2C', b: '#6B4A2E', y: '#F4D35E', w: '#E8E8E8', s: '#9AA3B5', r: '#C94A4A', p: '#B78CFF', c: '#5FC9F8', o: '#E07A3A', m: '#F2E3A1', d: '#3A2818' };

export const ACHIEVEMENTS = [
  { id: 'first', test: (x) => x.sessions >= 1, art: '...gg......gggg....gggggg..gggggggg...bb......bb......bb.....dddd..' },
  { id: 'hours10', test: (x) => x.hours >= 10, art: '..yyyy...y....y.y..y..y.y..yyy.y.y....y..y....y...yyyy..........' },
  { id: 'hours100', test: (x) => x.hours >= 100, art: '.yyyyyy.y.yyyy.yyy.yy.yy.yyyyyy...yyyy.....yy.....yyyy...yyyyyy.' },
  { id: 'marathon', test: (x) => x.longest >= 4 * 3600, art: '..ssss...s....s.s..s...ss..sss.ss......ss......s.s....s..ssss...' },
  { id: 'nightOwl', test: (x) => x.night >= 1, art: '..mmm....mm.......m........m........mm.....m.mmm....mmm.........' },
  { id: 'collector', test: (x) => x.instances >= 5, art: 'bbbbbbbbbmmbmmbbbbbbbbbbbmmbmmbbbbbbbbbbbmmbmmbbbbbbbbbb........' },
  { id: 'explorer', test: (x) => x.loaders >= 3, art: '...cc.....cccc...cc..cc.cc....cccc....cc.cc..cc...cccc.....cc...' },
  { id: 'upgrade', test: (x) => x.updates >= 1, art: '...gg.....gggg...gggggg.gg.gg.gg...gg......gg......gg......gg....' },
  { id: 'builder', test: (x) => x.installs >= 25, art: '.ssssss..s....s..ssssss....ss......ss......bb......bb......bb....' },
  { id: 'artist', test: (x) => x.themes >= 1, art: '..pppp...pyppcp.pppppppp.prppgpp.pppppp...pp.....pp......pp.....' },
  { id: 'dj', test: (x) => x.favTracks >= 5, art: '..kkkk...kkkkkk.kkkrrkkkkkrkkrkkkkkrrkkk.kkkkkk...kkkk..........' },
  { id: 'moving', test: (x) => x.prism >= 1, art: '.......o......oo.ooooooooooooooooo.....oo......o.......o........' },
];

export function artSvg(art, size = 28) {
  let rects = '';
  for (let i = 0; i < 64; i++) {
    const col = P[art[i]];
    if (col) rects += `<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1" height="1" fill="${col}"/>`;
  }
  return `<svg viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

/** Собирает цифры для проверки достижений */
export function facts({ sessions = [], instances = [], settings = {} }) {
  const total = sessions.reduce((a, s) => a + (s.seconds || 0), 0);
  const c = settings.counters || {};
  return {
    sessions: sessions.length,
    hours: total / 3600,
    longest: sessions.reduce((a, s) => Math.max(a, s.seconds || 0), 0),
    night: sessions.filter((s) => { const h = new Date(s.start * 1000).getHours(); return h >= 0 && h < 5; }).length,
    instances: instances.length,
    loaders: new Set(instances.map((i) => i.loader)).size,
    updates: c.updates || 0,
    installs: c.installs || 0,
    themes: (settings.customThemes || []).length,
    favTracks: (settings.musicFav || []).length,
    prism: c.prism || 0,
  };
}

/** Какие достижения только что открылись */
export function newlyUnlocked(x, unlocked = {}) {
  return ACHIEVEMENTS.filter((a) => !unlocked[a.id] && a.test(x)).map((a) => a.id);
}

// ---------- Spectia Wrapped ----------

/** Итоги года доступны с 1 декабря по 31 января. Возвращает год итогов или null. */
export function wrappedYear(now = new Date()) {
  if (new URLSearchParams(location.search).has('wrapped')) return now.getFullYear();
  const m = now.getMonth();
  if (m === 11) return now.getFullYear();
  if (m === 0) return now.getFullYear() - 1;
  return null;
}

export function wrappedData(sessions, year) {
  const list = sessions.filter((s) => new Date(s.start * 1000).getFullYear() === year);
  if (!list.length) return null;
  const sum = (arr, key) => {
    const m = {};
    for (const s of arr) m[key(s)] = (m[key(s)] || 0) + s.seconds;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const total = list.reduce((a, s) => a + s.seconds, 0);
  const byInst = sum(list, (s) => s.name || s.instance);
  const byVer = sum(list, (s) => s.gameVersion);
  const byLoader = sum(list, (s) => s.loader);
  const byMonth = sum(list, (s) => new Date(s.start * 1000).getMonth());
  const longest = list.reduce((a, s) => (s.seconds > a.seconds ? s : a), list[0]);
  const days = new Set(list.map((s) => new Date(s.start * 1000).toDateString())).size;
  return {
    year, total, sessions: list.length, days,
    topInstance: byInst[0], instances: byInst.length,
    topVersion: byVer[0]?.[0], topLoader: byLoader[0]?.[0],
    topMonth: Number(byMonth[0]?.[0] ?? 0),
    longest,
    night: list.filter((s) => new Date(s.start * 1000).getHours() < 5).length,
  };
}
