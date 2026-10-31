// Достижения Spectia 2.0 — в духе Minecraft: коротко и по делу.
//
// У каждого достижения есть уровень, как у руд: железо → золото → алмаз → незерит.
// Некоторые выстроены в цепочки (1 час → 10 часов → 100 часов), есть праздничная коллекция
// (открывается, если зайти в Spectia в нужный день) и награда за полную коллекцию.
// Всё считается по тому, что лаунчер и так знает. Ничего никуда не отправляется.

export const TIERS = ['iron', 'gold', 'diamond', 'netherite'];

/** Пиксельные картинки 8×8: строка из 64 символов, каждый — цвет из палитры */
const P = { '.': '', k: '#1C1C1C', g: '#4E9A3A', G: '#2E6B2C', b: '#6B4A2E', y: '#F4D35E', w: '#E8E8E8', s: '#9AA3B5', r: '#C94A4A', p: '#B78CFF', c: '#5FC9F8', o: '#E07A3A', m: '#F2E3A1', d: '#3A2818', n: '#4A3A46', P: '#FF8CC6' };
const ART = {
  sapling: '...gg......gggg....gggggg..gggggggg...bb......bb......bb.....dddd..',
  clock: '..yyyy...y....y.y..y..y.y..yyy.y.y....y..y....y...yyyy..........',
  star: '...yy......yy...yyyyyyyy.yyyyyy...yyyy...yy..yy..y....y.........',
  hourglass: '.ssssss..s....s...s..s.....ss......ss.....s..s...s.yy.s..ssssss.',
  moon: '..mmm....mm.......m........m........mm.....m.mmm....mmm.........',
  chest: 'bbbbbbbbbmmbmmbbbbbbbbbbbmmbmmbbbbbbbbbbbmmbmmbbbbbbbbbb........',
  compass: '...cc.....cccc...cc..cc.cc....cccc....cc.cc..cc...cccc.....cc...',
  arrow: '...gg.....gggg...gggggg.gg.gg.gg...gg......gg......gg......gg....',
  anvil: '.ssssss..s....s..ssssss....ss......ss......bb......bb......bb....',
  palette: '..pppp...pyppcp.pppppppp.prppgpp.pppppp...pp.....pp......pp.....',
  disc: '..kkkk...kkkkkk.kkkrrkkkkkrkkrkkkkkrrkkk.kkkkkk...kkkk..........',
  boat: '.......o......oo.ooooooooooooooooo.....oo......o.......o........',
  book: '.bbbbbb..bwwwwb..bwkkwb..bwwwwb..bwkkwb..bwwwwb..bbbbbb.........',
  pumpkin: '...gg.....oooo...oooooo..okoko..oooooo..okkkko...oooo...........',
  cake: '..r..r....w..w...wwwwww..PPPPPP.wwwwwwwwmmmmmmmmmmmmmmmm........',
  tree: '...gg......gg.....gygg....gggg....gggrgg..gggggg.....bb.....bbbb.',
  heart: '.rr..rr.rrrrrrrrrrrrrrrrrrrrrrrr.rrrrrr...rrrr.....rr...........',
  creeper: 'gggggggggkkggkkggkkggkkgggkkkkgggkkkkgggkggkgggggggggg........',
  crown: 'y..yy..yyy.yy.yyyyyyyyyyyyrryryyyyyyyyy..........................',
};

/** Обычные достижения. chain — цепочка, step — шаг в ней. */
export const ACHIEVEMENTS = [
  { id: 'first', tier: 'iron', art: 'sapling', test: (x) => x.sessions >= 1 },
  { id: 'hours1', tier: 'iron', art: 'clock', chain: 'time', step: 1, test: (x) => x.hours >= 1 },
  { id: 'hours10', tier: 'gold', art: 'clock', chain: 'time', step: 2, test: (x) => x.hours >= 10 },
  { id: 'hours100', tier: 'diamond', art: 'star', chain: 'time', step: 3, test: (x) => x.hours >= 100 },
  { id: 'hours500', tier: 'netherite', art: 'star', chain: 'time', step: 4, test: (x) => x.hours >= 500 },
  { id: 'marathon', tier: 'gold', art: 'hourglass', test: (x) => x.longest >= 4 * 3600 },
  { id: 'nightOwl', tier: 'iron', art: 'moon', test: (x) => x.night >= 1 },
  { id: 'inst2', tier: 'iron', art: 'chest', chain: 'collect', step: 1, test: (x) => x.instances >= 2 },
  { id: 'collector', tier: 'gold', art: 'chest', chain: 'collect', step: 2, test: (x) => x.instances >= 5 },
  { id: 'inst10', tier: 'diamond', art: 'chest', chain: 'collect', step: 3, test: (x) => x.instances >= 10 },
  { id: 'explorer', tier: 'gold', art: 'compass', test: (x) => x.loaders >= 3 },
  { id: 'upgrade', tier: 'iron', art: 'arrow', test: (x) => x.updates >= 1 },
  { id: 'install1', tier: 'iron', art: 'anvil', chain: 'build', step: 1, test: (x) => x.installs >= 1 },
  { id: 'builder', tier: 'gold', art: 'anvil', chain: 'build', step: 2, test: (x) => x.installs >= 25 },
  { id: 'install100', tier: 'diamond', art: 'anvil', chain: 'build', step: 3, test: (x) => x.installs >= 100 },
  { id: 'artist', tier: 'gold', art: 'palette', test: (x) => x.themes >= 1 },
  { id: 'dj', tier: 'iron', art: 'disc', test: (x) => x.favTracks >= 5 },
  { id: 'moving', tier: 'gold', art: 'boat', test: (x) => x.prism >= 1 },
  { id: 'reader', tier: 'iron', art: 'book', test: (x) => x.wiki >= 1 },
  { id: 'timeTraveler', tier: 'diamond', art: 'hourglass', test: (x) => x.restores >= 1 },
];

/** Праздничная коллекция: открывается, если зайти в Spectia в этот день (или рядом) */
export const SEASONAL = [
  { id: 'halloween', art: 'pumpkin', when: (m, d) => (m === 9 && d >= 25) || (m === 10 && d <= 2) },
  { id: 'birthday', art: 'cake', when: (m, d) => m === 9 && d === 31 },
  { id: 'newYear', art: 'tree', when: (m, d) => (m === 11 && d >= 25) || (m === 0 && d <= 7) },
  { id: 'valentine', art: 'heart', when: (m, d) => m === 1 && d >= 13 && d <= 15 },
  { id: 'mcBirthday', art: 'creeper', when: (m, d) => m === 4 && d >= 16 && d <= 18 },
];

/** Награда за все обычные достижения */
export const PERFECT = { id: 'legend', tier: 'netherite', art: 'crown' };

export function artSvg(art, size = 28) {
  const str = ART[art] || art || '';
  let rects = '';
  for (let i = 0; i < 64; i++) {
    const col = P[str[i]];
    if (col) rects += `<rect x="${i % 8}" y="${Math.floor(i / 8)}" width="1" height="1" fill="${col}"/>`;
  }
  return `<svg viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

export const find = (id) => ACHIEVEMENTS.find((a) => a.id === id) || SEASONAL.find((a) => a.id === id) || (id === PERFECT.id ? PERFECT : null);
export const tierOf = (id) => find(id)?.tier || 'gold';

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
    wiki: c.wiki || 0,
    restores: c.restores || 0,
  };
}

/** Какие достижения только что открылись (включая праздничные и «Легенду») */
export function newlyUnlocked(x, unlocked = {}, now = new Date()) {
  const out = ACHIEVEMENTS.filter((a) => !unlocked[a.id] && a.test(x)).map((a) => a.id);
  for (const s of SEASONAL) if (!unlocked[s.id] && s.when(now.getMonth(), now.getDate())) out.push(s.id);
  const all = new Set([...Object.keys(unlocked), ...out]);
  if (!unlocked[PERFECT.id] && ACHIEVEMENTS.every((a) => all.has(a.id))) out.push(PERFECT.id);
  return out;
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
