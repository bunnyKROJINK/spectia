// Переводы интерфейса.
import ru from '../i18n/ru.js';
import en from '../i18n/en.js';
import uk from '../i18n/uk.js';
import es from '../i18n/es.js';
import de from '../i18n/de.js';
import kk from '../i18n/kk.js';
import zh from '../i18n/zh.js';
import ja from '../i18n/ja.js';
import pt from '../i18n/pt.js';
import lt from '../i18n/lt.js';
import lv from '../i18n/lv.js';

// Новый язык добавляется сюда одной строчкой.
export const LANGS = { ru, en, uk, es, de, kk, zh, ja, pt, lt, lv };

/** Полные коды языков для дат и чисел */
const LOCALES = { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', es: 'es-ES', de: 'de-DE', kk: 'kk-KZ', zh: 'zh-CN', ja: 'ja-JP', pt: 'pt-BR', lt: 'lt-LT', lv: 'lv-LV' };

export function locale() {
  return LOCALES[current] || 'ru-RU';
}

let current = 'ru';

export function setLang(code) {
  current = LANGS[code] ? code : 'ru';
  document.documentElement.lang = LOCALES[current] || current;
}

export function getLang() {
  return current;
}

/**
 * Возвращает текст по ключу. Можно подставлять значения:
 * t('home.ram', { gb: 4 }) → «4 ГБ ОЗУ»
 * Если перевода нет, берём русский, а если и его нет — сам ключ.
 */
export function t(key, params) {
  // Если в языке чего-то не хватает — сначала английский (его понимают чаще), потом русский
  let text = LANGS[current][key] ?? (current === 'kk' ? LANGS.ru[key] ?? LANGS.en[key] : LANGS.en[key] ?? LANGS.ru[key]) ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll('{' + name + '}', String(value));
    }
  }
  return text;
}

/** Красиво печатает число: 1234567 → «1 234 567» / "1,234,567" */
export function formatNumber(n) {
  return new Intl.NumberFormat(locale()).format(n);
}
