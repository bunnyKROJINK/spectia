// Переводы интерфейса.
import ru from '../i18n/ru.js';
import en from '../i18n/en.js';

// Новый язык добавляется сюда одной строчкой.
export const LANGS = { ru, en };

let current = 'ru';

export function setLang(code) {
  current = LANGS[code] ? code : 'ru';
  document.documentElement.lang = current;
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
  let text = LANGS[current][key] ?? LANGS.ru[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll('{' + name + '}', String(value));
    }
  }
  return text;
}

/** Красиво печатает число: 1234567 → «1 234 567» / "1,234,567" */
export function formatNumber(n) {
  return new Intl.NumberFormat(current === 'ru' ? 'ru-RU' : 'en-US').format(n);
}
