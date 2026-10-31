// Умный поиск: находит мод, даже если название написано «не тютелька в тютельку».
//
//  • без пробелов и знаков: «farmersdelight», «farmers delight» → Farmer's Delight
//  • сокращения по первым буквам: «jei» → Just Enough Items, «fd» → Farmer's Delight
//  • забыли переключить раскладку: «ыщвшгь» → sodium
//  • русские буквы по звучанию: «содиум» → sodium, «ирис» → iris
//
// Специально НЕ угадываем опечатки: так поиск не начнёт показывать «не те» моды.

/** Только буквы и цифры в нижнем регистре: "Farmer's Delight" → "farmersdelight" */
export function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Первые буквы слов: "Just Enough Items" → "jei", "Farmer's Delight" → "fd" */
export function initials(s) {
  return String(s || '')
    .replace(/'s\b/gi, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join('')
    .toLowerCase();
}

// Клавиши русской раскладки → те же клавиши в английской
const RU = 'йцукенгшщзхъфывапролджэячсмитьбю.ё';
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,./`";

/** «ыщвшгь» → «sodium» (если забыли переключить раскладку) */
export function fixLayout(s) {
  return String(s || '')
    .toLowerCase()
    .split('')
    .map((ch) => {
      const i = RU.indexOf(ch);
      return i >= 0 ? EN[i] : ch;
    })
    .join('');
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** «содиум» → «sodium» */
export function translit(s) {
  return String(s || '').toLowerCase().split('').map((ch) => TRANSLIT[ch] ?? ch).join('');
}

const hasCyrillic = (s) => /[а-яё]/i.test(s);

/** Варианты запроса, которые стоит попробовать (без повторов). */
export function queryVariants(q) {
  const raw = String(q || '').trim();
  if (!raw) return [''];
  const list = [raw];
  // Без апострофов и лишних знаков: "farmer's" и "farmers" ищутся одинаково
  list.push(raw.replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
  if (hasCyrillic(raw)) {
    list.push(fixLayout(raw));
    list.push(translit(raw));
  }
  return [...new Set(list.filter(Boolean))];
}

/**
 * Насколько название подходит под запрос (0 — не подходит).
 * Чем больше число, тем выше в списке.
 */
export function matchScore(query, title, slug = '') {
  let best = 0;
  for (const v of queryVariants(query)) {
    const q = normalize(v);
    if (!q) continue;
    const t = normalize(title);
    const sl = normalize(slug);
    if (t === q || sl === q) best = Math.max(best, 100);
    else if (t.startsWith(q) || sl.startsWith(q)) best = Math.max(best, 80);
    else if (q.length >= 3 && (t.includes(q) || sl.includes(q))) best = Math.max(best, 60);
    else if (q.length >= 2 && q.length <= 6 && /^[a-z0-9]+$/.test(q) && initials(title).startsWith(q)) best = Math.max(best, 70);
  }
  return best;
}
