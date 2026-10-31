// Плоский предпросмотр скина Minecraft: спереди, сзади и сбоку.
//
// Файл скина — это «развёртка» 64×64 (или старая 64×32): на ней отдельно нарисованы
// все стороны головы, тела, рук и ног. Мы вырезаем нужные кусочки и складываем
// из них человечка 16×32 пикселя, а дальше CSS увеличивает его без размытия.

const W = 16;
const H = 32;

/** Кусок развёртки: x, y, ширина, высота → куда положить на холсте */
function part(ctx, img, sx, sy, sw, sh, dx, dy, mirror = false) {
  if (!mirror) return ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
  ctx.save();
  ctx.translate(dx + sw, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}

function draw(ctx, img, side, slim, cape) {
  const legacy = img.height === 32; // старый формат: левые руки и ноги — зеркало правых
  const a = slim ? 3 : 4;            // ширина руки
  const layers = !legacy;
  ctx.clearRect(0, 0, W, H);

  if (side === 'front') {
    // Голова, тело
    part(ctx, img, 8, 8, 8, 8, 4, 0);
    part(ctx, img, 20, 20, 8, 12, 4, 8);
    // Правая рука персонажа — слева от нас
    part(ctx, img, 44, 20, a, 12, 4 - a, 8);
    if (legacy) part(ctx, img, 44, 20, a, 12, 12, 8, true);
    else part(ctx, img, 36, 52, a, 12, 12, 8);
    // Ноги
    part(ctx, img, 4, 20, 4, 12, 4, 20);
    if (legacy) part(ctx, img, 4, 20, 4, 12, 8, 20, true);
    else part(ctx, img, 20, 52, 4, 12, 8, 20);
    // Второй слой: шапка, куртка, рукава, штанины
    part(ctx, img, 40, 8, 8, 8, 4, 0);
    if (layers) {
      part(ctx, img, 20, 36, 8, 12, 4, 8);
      part(ctx, img, 44, 36, a, 12, 4 - a, 8);
      part(ctx, img, 52, 52, a, 12, 12, 8);
      part(ctx, img, 4, 36, 4, 12, 4, 20);
      part(ctx, img, 4, 52, 4, 12, 8, 20);
    }
  } else if (side === 'back') {
    part(ctx, img, 24, 8, 8, 8, 4, 0);
    part(ctx, img, 32, 20, 8, 12, 4, 8);
    // Сзади левая рука персонажа оказывается слева от нас
    if (legacy) part(ctx, img, 48 + a, 20, a, 12, 4 - a, 8, true);
    else part(ctx, img, 40 + a, 52, a, 12, 4 - a, 8);
    part(ctx, img, 48 + a, 20, a, 12, 12, 8);
    if (legacy) part(ctx, img, 12, 20, 4, 12, 4, 20, true);
    else part(ctx, img, 28, 52, 4, 12, 4, 20);
    part(ctx, img, 12, 20, 4, 12, 8, 20);
    part(ctx, img, 56, 8, 8, 8, 4, 0);
    if (layers) {
      part(ctx, img, 32, 36, 8, 12, 4, 8);
      part(ctx, img, 56 + a, 52, a, 12, 4 - a, 8);
      part(ctx, img, 48 + a, 36, a, 12, 12, 8);
      part(ctx, img, 12, 52, 4, 12, 4, 20);
      part(ctx, img, 12, 36, 4, 12, 8, 20);
    }
    // Плащ поверх спины
    if (cape) part(ctx, cape, 1, 1, 10, 16, 3, 8);
  } else {
    // Правый бок: голова 8 в ширину, тело/рука/нога — по 4
    part(ctx, img, 0, 8, 8, 8, 4, 0);
    part(ctx, img, 16, 20, 4, 12, 6, 8);
    part(ctx, img, 0, 20, 4, 12, 6, 20);
    part(ctx, img, 40, 20, 4, 12, 6, 8);
    part(ctx, img, 32, 8, 8, 8, 4, 0);
    if (layers) {
      part(ctx, img, 0, 36, 4, 12, 6, 20);
      part(ctx, img, 40, 36, 4, 12, 6, 8);
    }
    if (cape) part(ctx, cape, 0, 1, 1, 16, 5, 8);
  }
}

const cache = new Map();
function load(src) {
  if (!src) return Promise.resolve(null);
  if (!cache.has(src)) {
    cache.set(src, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return cache.get(src);
}

/** Разметка холста. Рисуется потом функцией paintSkins(). */
export function skinCanvas({ image, slim = false, side = 'front', cape = '', size = 160, label = '' }) {
  const attr = (s) => String(s).replace(/"/g, '&quot;');
  return `<canvas class="skin-canvas" width="${W}" height="${H}" style="width:${size / 2}px;height:${size}px"
    data-skin="${attr(image || '')}" data-slim="${slim ? 1 : 0}" data-side="${side}" data-cape="${attr(cape || '')}"
    role="img" aria-label="${attr(label)}"></canvas>`;
}

/** Дорисовывает все холсты со скинами, которые сейчас на экране. */
export function paintSkins(root = document) {
  root.querySelectorAll('canvas.skin-canvas').forEach(async (c) => {
    const [img, cape] = await Promise.all([load(c.dataset.skin || DEFAULT_SKIN), load(c.dataset.cape)]);
    if (!img) return;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    draw(ctx, img, c.dataset.side, c.dataset.slim === '1', cape);
  });
  // Лица: голова спереди + «шапка» (второй слой)
  root.querySelectorAll('canvas.face-canvas').forEach(async (c) => {
    const img = await load(c.dataset.skin);
    if (!img) return;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 8, 8);
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
    ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
  });
  // Маленькие картинки плащей: лицевая часть 10×16 из развёртки плаща
  root.querySelectorAll('canvas.cape-canvas').forEach(async (c) => {
    const cape = await load(c.dataset.cape);
    if (!cape) return;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 10, 16);
    ctx.drawImage(cape, 1, 1, 10, 16, 0, 0, 10, 16);
  });
}

/** Проверяет, что картинка похожа на скин: PNG 64×64 или 64×32. */
export async function isSkinImage(src) {
  const img = await load(src);
  return !!img && img.width === 64 && (img.height === 64 || img.height === 32);
}

// Свой простой скин «по умолчанию», если у аккаунта нет скина: нарисован прямо здесь,
// чтобы не тянуть картинки Mojang.
const DEFAULT_SKIN = (() => {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const x = c.getContext('2d');
  const box = (color, ...rects) => { x.fillStyle = color; rects.forEach(([a, b, w, h]) => x.fillRect(a, b, w, h)); };
  box('#C8A07A', [0, 8, 32, 8]);                       // голова со всех сторон
  box('#3B2A22', [0, 8, 32, 2], [8, 0, 16, 8], [24, 8, 8, 8]); // волосы
  box('#3B2A22', [8, 10, 1, 2], [15, 10, 1, 2]);
  box('#FFFFFF', [9, 12, 2, 1], [13, 12, 2, 1]);
  box('#6A5ACD', [10, 12, 1, 1], [13, 12, 1, 1]);
  box('#A97E5C', [11, 14, 2, 1]);
  box('#8A6FE0', [16, 20, 24, 12]);                    // кофта
  box('#6A5ACD', [40, 20, 16, 12], [32, 52, 16, 12]);  // рукава
  box('#C8A07A', [40, 29, 16, 3], [32, 61, 16, 3]);    // ладони
  box('#2C3354', [0, 20, 16, 12], [16, 52, 16, 12]);   // штаны
  box('#1A1D2E', [0, 30, 16, 2], [16, 62, 16, 2]);     // ботинки
  return c.toDataURL('image/png');
})();

/** Лицо скина (8×8, увеличенное без размытия) */
export function faceCanvas(image, size = 36, label = '') {
  const attr = (v) => String(v).replace(/"/g, '&quot;');
  return `<canvas class="face face-canvas" width="8" height="8" style="width:${size}px;height:${size}px" data-skin="${attr(image)}" role="img" aria-label="${attr(label)}"></canvas>`;
}
