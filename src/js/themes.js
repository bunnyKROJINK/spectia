// Темы оформления Spectia.
// Каждая тема — это набор цветов. Они превращаются в CSS-переменные (--bg, --accent и т.д.),
// а все стили в styles.css берут цвета только из этих переменных.
//
// Хотите свою тему? Скопируйте любую, поменяйте цвета и добавьте её id в THEME_ORDER.

const DARK = {
  text: '#ECEEFA', muted: '#A9AFCF',
  surface: 'rgba(255,255,255,0.035)', surface2: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.09)', ghost: 'rgba(255,255,255,0.04)',
  input: 'rgba(0,0,0,0.25)', hover: 'rgba(255,255,255,0.08)',
  navText: '#C3C8E4', navOn: '#FFFFFF', track: 'rgba(255,255,255,0.18)',
  warnText: '#FFC77A', warnSoft: 'rgba(255,184,77,0.16)',
  scheme: 'dark',
};

export const THEMES = {
  night: { ...DARK,
    bg: '#0B0D1A', dialog: '#161A2E', g1: 'rgba(120,92,255,0.28)', g2: 'rgba(40,140,200,0.22)',
    accent: '#8B9CFF', accentInk: '#0B0D1A', accentSoft: 'rgba(139,156,255,0.18)', accentText: '#C9D0FF',
    glow: 'rgba(139,156,255,0.35)', avatar: 'linear-gradient(135deg,#6A5ACD,#2E8BC0)' },
  emerald: { ...DARK,
    bg: '#07130F', dialog: '#10221B', g1: 'rgba(40,200,130,0.24)', g2: 'rgba(20,130,150,0.2)',
    accent: '#4ADE9A', accentInk: '#06140E', accentSoft: 'rgba(74,222,154,0.16)', accentText: '#A8F0CC',
    glow: 'rgba(74,222,154,0.32)', avatar: 'linear-gradient(135deg,#1F8F63,#1C6E85)',
    navText: '#C2DDD1', muted: '#A2C2B5' },
  sakura: { ...DARK,
    bg: '#170B15', dialog: '#26131F', g1: 'rgba(255,120,190,0.26)', g2: 'rgba(150,80,220,0.2)',
    accent: '#FF8CC6', accentInk: '#1A0A14', accentSoft: 'rgba(255,140,198,0.16)', accentText: '#FFC2E0',
    glow: 'rgba(255,140,198,0.32)', avatar: 'linear-gradient(135deg,#D9579A,#8A4FD1)',
    navText: '#E2C6D6', muted: '#C9A9BC' },
  ruby: { ...DARK,
    bg: '#170A0C', dialog: '#261216', g1: 'rgba(255,80,95,0.26)', g2: 'rgba(210,100,40,0.18)',
    accent: '#FF6B78', accentInk: '#1A0709', accentSoft: 'rgba(255,107,120,0.16)', accentText: '#FFC0C6',
    glow: 'rgba(255,107,120,0.32)', avatar: 'linear-gradient(135deg,#C93A4A,#C9652A)',
    navText: '#E2C3C6', muted: '#C9A6AA' },
  light: {
    scheme: 'light',
    bg: '#F2F3FA', dialog: '#FFFFFF', g1: 'rgba(120,140,255,0.2)', g2: 'rgba(80,190,230,0.16)',
    accent: '#4F5BD5', accentInk: '#FFFFFF', accentSoft: 'rgba(79,91,213,0.12)', accentText: '#3540B0',
    glow: 'rgba(79,91,213,0.3)', avatar: 'linear-gradient(135deg,#6A5ACD,#2E8BC0)',
    text: '#15172A', muted: '#535978', surface: 'rgba(255,255,255,0.72)', surface2: 'rgba(255,255,255,0.9)',
    border: 'rgba(20,24,60,0.12)', ghost: 'rgba(255,255,255,0.8)', input: '#FFFFFF', hover: 'rgba(20,24,60,0.06)',
    navText: '#3D4262', navOn: '#15172A', track: 'rgba(20,24,60,0.2)',
    warnText: '#8A4B00', warnSoft: 'rgba(255,170,50,0.18)' },
  midnight: { ...DARK,
    bg: '#000000', dialog: '#111114', g1: 'rgba(255,255,255,0.035)', g2: 'rgba(255,255,255,0.02)',
    accent: '#E4E6EE', accentInk: '#000000', accentSoft: 'rgba(255,255,255,0.1)', accentText: '#F2F3F7',
    glow: 'rgba(255,255,255,0.12)', avatar: 'linear-gradient(135deg,#3A3A44,#1C1C22)',
    surface: 'rgba(255,255,255,0.03)', muted: '#A4A6B2', navText: '#BDBFCA' },
  amethyst: { ...DARK,
    bg: '#120B1E', dialog: '#1F1430', g1: 'rgba(160,100,255,0.28)', g2: 'rgba(110,60,200,0.22)',
    accent: '#B78CFF', accentInk: '#140A22', accentSoft: 'rgba(183,140,255,0.18)', accentText: '#DCC8FF',
    glow: 'rgba(183,140,255,0.35)', avatar: 'linear-gradient(135deg,#8A5CF0,#5B3DB8)',
    navText: '#D3C6EA', muted: '#B3A6CC' },
  space: { ...DARK, deco: 'space',
    bg: '#070A1C', dialog: '#11163A', g1: 'rgba(90,110,255,0.26)', g2: 'rgba(180,90,255,0.18)',
    accent: '#7FA8FF', accentInk: '#060A1C', accentSoft: 'rgba(127,168,255,0.18)', accentText: '#C6D6FF',
    glow: 'rgba(127,168,255,0.35)', avatar: 'linear-gradient(135deg,#4A5BD9,#8A4FD1)',
    navText: '#C3C9E8', muted: '#A4ABD0' },
  ocean: { ...DARK, deco: 'ocean',
    bg: '#04141C', dialog: '#0B2430', g1: 'rgba(40,180,210,0.26)', g2: 'rgba(30,110,200,0.22)',
    accent: '#4FD8E8', accentInk: '#031318', accentSoft: 'rgba(79,216,232,0.16)', accentText: '#B4F0F7',
    glow: 'rgba(79,216,232,0.32)', avatar: 'linear-gradient(135deg,#1F8FB0,#1C5E9E)',
    navText: '#BFDDE4', muted: '#9DC0C9' },
  halloween: { ...DARK, deco: 'halloween',
    bg: '#140B06', dialog: '#24140B', g1: 'rgba(255,130,40,0.26)', g2: 'rgba(140,60,200,0.16)',
    accent: '#FF9A3C', accentInk: '#1A0C03', accentSoft: 'rgba(255,154,60,0.16)', accentText: '#FFD0A3',
    glow: 'rgba(255,154,60,0.34)', avatar: 'linear-gradient(135deg,#E06A12,#7A3DB0)',
    navText: '#E5CDB8', muted: '#C9AE98' },
  // Градиентные темы: второй цвет акцента и мягкий переход фона
  sunset: { ...DARK, bgMode: 'diagonal',
    bg: '#1A0E14', bg2: '#2A1220', dialog: '#2A1620', g1: 'rgba(255,140,80,0.22)', g2: 'rgba(255,90,150,0.18)',
    accent: '#FF9A55', accent2: '#FF5C9A', accentInk: '#1A0A0C', accentSoft: 'rgba(255,130,100,0.16)', accentText: '#FFC9AE',
    glow: 'rgba(255,120,110,0.34)', avatar: 'linear-gradient(135deg,#E8743A,#D63C7A)', navText: '#E8CCD2', muted: '#CDA9B2' },
  aurora: { ...DARK, bgMode: 'glow',
    bg: '#06121A', bg2: '#120C24', dialog: '#0F1E2A', g1: 'rgba(60,230,160,0.22)', g2: 'rgba(150,90,255,0.24)',
    accent: '#4FE3A8', accent2: '#A07CFF', accentInk: '#04140F', accentSoft: 'rgba(79,227,168,0.15)', accentText: '#B5F5DC',
    glow: 'rgba(110,200,220,0.34)', avatar: 'linear-gradient(135deg,#25B47E,#7A4FE0)', navText: '#C3DCE0', muted: '#9DBAC2' },
  deep: { ...DARK, bgMode: 'vertical',
    bg: '#071224', bg2: '#04202A', dialog: '#0E1E33', g1: 'rgba(60,140,255,0.2)', g2: 'rgba(40,210,210,0.18)',
    accent: '#4C9BFF', accent2: '#39D5D0', accentInk: '#04101F', accentSoft: 'rgba(76,155,255,0.16)', accentText: '#BCD9FF',
    glow: 'rgba(60,180,230,0.34)', avatar: 'linear-gradient(135deg,#2F6FD6,#1FA8A4)', navText: '#C1D2E4', muted: '#9DB1C8' },
  // Награда за все достижения
  netherite: { ...DARK, bgMode: 'diagonal',
    bg: '#141113', bg2: '#1E1820', dialog: '#221D22', g1: 'rgba(200,160,100,0.18)', g2: 'rgba(140,110,180,0.16)',
    accent: '#D9B26A', accent2: '#9C7FC4', accentInk: '#140F08', accentSoft: 'rgba(217,178,106,0.15)', accentText: '#F0D9A8',
    glow: 'rgba(217,178,106,0.32)', avatar: 'linear-gradient(135deg,#6B5A4A,#4A3A5A)', navText: '#D8CFCF', muted: '#B3A8AE' },
};

export const THEME_ORDER = ['night', 'emerald', 'sakura', 'ruby', 'amethyst', 'space', 'ocean', 'halloween', 'sunset', 'aurora', 'deep', 'light', 'midnight'];

/** Переводит camelCase в kebab-case: accentInk → accent-ink */
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

/** Применяет тему ко всему окну. */
export function applyTheme(id) {
  const theme = THEMES[id] || THEMES.sakura;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme)) {
    if (key !== 'scheme' && key !== 'deco' && key !== 'bgMode' && key !== 'accent2' && key !== 'bg2') root.style.setProperty('--' + kebab(key), value);
  }
  root.style.colorScheme = theme.scheme;
}

/** Обложки сборок. */
export const TINTS = [
  'linear-gradient(135deg,#3A2E86,#1D5E8C)',
  'linear-gradient(135deg,#5B2A6E,#A0526B)',
  'linear-gradient(135deg,#1E4D4A,#2D7A5E)',
  'linear-gradient(135deg,#3B1F3A,#7A2E3B)',
  'linear-gradient(135deg,#6B4A1E,#A8792E)',
  'linear-gradient(135deg,#1F2F55,#3E5FA0)',
];
