// Spectia Doctor: читает логи игры и объясняет человеческими словами, что пошло не так.
//
// Каждое правило ищет в логе знакомую «примету» ошибки и возвращает находку:
// { id, level: 'error' | 'warn', params } — текст подставляется из переводов (doc.<id>.title / doc.<id>.text).

const RULES = [
  {
    id: 'memory',
    test: (log) => /java\.lang\.OutOfMemoryError|Could not reserve enough space|There is insufficient memory/i.test(log),
  },
  {
    id: 'java',
    // Мод или игра собраны под Java новее, чем та, что запущена
    test: (log) => {
      const m = log.match(/has been compiled by a more recent version of the Java Runtime \(class file version ([\d.]+)\)/);
      if (!m) return /UnsupportedClassVersionError/.test(log) && {};
      const javaOf = { 52: 8, 55: 11, 60: 16, 61: 17, 65: 21, 66: 22, 67: 23, 68: 24, 69: 25 };
      return { java: javaOf[Math.floor(Number(m[1]))] || '' };
    },
  },
  {
    id: 'fabricDep',
    // Fabric: «Mod 'Sodium' (sodium) 0.5.8 requires version 0.15 or later of fabricloader»
    test: (log) => {
      const out = [];
      for (const m of log.matchAll(/Mod '([^']+)' \(([^)]+)\) [^\s]+ requires (?:version ([^\s]+(?: or later)?) of |any version of )'?([^',\s]+)'?/g)) {
        out.push({ mod: m[1], need: m[4], version: m[3] || '' });
      }
      return out.length ? { list: out } : null;
    },
  },
  {
    id: 'forgeDep',
    // Forge / NeoForge: «Mod ID: 'geckolib', Requested by: 'mowziesmobs', Expected range: '[4.4,)'»
    test: (log) => {
      const out = [];
      for (const m of log.matchAll(/Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']*)'/g)) {
        out.push({ need: m[1], mod: m[2], version: m[3], actual: m[4] });
      }
      if (!out.length && /Missing or unsupported mandatory dependencies/i.test(log)) return { list: [] };
      return out.length ? { list: out } : null;
    },
  },
  {
    id: 'incompatible',
    test: (log) => {
      const out = [];
      for (const m of log.matchAll(/Mod '([^']+)' \([^)]+\) [^\s]+ is incompatible with (?:any version of )?(?:mod )?'?([^',\s]+)'?/g)) out.push({ mod: m[1], other: m[2] });
      return out.length ? { list: out } : null;
    },
  },
  {
    id: 'duplicate',
    test: (log) => {
      const m = log.match(/(?:Found duplicate mods|Duplicate mods found|DuplicateModsFoundException)[^\n]*\n?([^\n]*)/i)
        || log.match(/Mod ID '([^']+)' from mod files: ([^\n]+)/);
      return m ? { detail: (m[2] || m[1] || '').trim().slice(0, 200) } : null;
    },
  },
  {
    id: 'mixin',
    // Сломанный мод: «Mixin apply for mod sodium failed» / «from mod xyz»
    test: (log) => {
      const m = log.match(/Mixin apply (?:for mod ([\w-]+) )?failed[^\n]*?(?:from mod ([\w-]+))?/i)
        || log.match(/MixinApplyError[^\n]*?(?:from mod ([\w-]+))/i)
        || log.match(/mixin[^\n]*?\[([\w-]+)\][^\n]*?failed/i);
      return m ? { mod: m[1] || m[2] || '' } : null;
    },
  },
  {
    id: 'wrongLoader',
    // Мод для другого загрузчика: Forge-мод в Fabric и наоборот
    test: (log) => /(?:is a (?:Forge|NeoForge) mod|requires (?:Forge|NeoForge)|Not a Fabric mod|is designed for (?:Forge|Fabric))/i.test(log) && {},
  },
  {
    id: 'graphics',
    test: (log) => /Pixel format not accelerated|GLFW error 65542|WGL: The driver does not appear to support OpenGL|OpenGL 3\.2 not supported|Failed to create window/i.test(log) && {},
  },
  {
    id: 'suspects',
    // Отчёт о вылете Forge: «Suspected Mod: Create (create), Version: 0.5.1»
    test: (log) => {
      const list = [...log.matchAll(/Suspected Mods?:\s*([^\n]+?)(?:,\s*Version|\n|$)/g)].map((m) => m[1].trim()).filter((s) => s && !/NONE/i.test(s));
      return list.length ? { mods: [...new Set(list)].join(', ') } : null;
    },
  },
];

/** Короткое описание вылета из отчёта: «Description: Ticking entity» */
export function crashDescription(text) {
  const m = String(text || '').match(/Description:\s*([^\n]+)/);
  return m ? m[1].trim() : '';
}

/**
 * Разбирает лог (и отчёт о вылете, если есть).
 * @returns {{ id: string, params: object }[]}
 */
export function diagnose(...texts) {
  const log = texts.filter(Boolean).join('\n');
  const found = [];
  for (const rule of RULES) {
    let res = false;
    try { res = rule.test(log); } catch { res = false; }
    if (res) found.push({ id: rule.id, params: res === true ? {} : res });
  }
  return found;
}

/** Уровень строки лога: error / warn / info — для подсветки */
export function lineLevel(line) {
  if (/\/(ERROR|FATAL)\]|^\s*at |Exception|Caused by:|\[STDERR\]/.test(line)) return 'error';
  if (/\/WARN\]/.test(line)) return 'warn';
  return 'info';
}
