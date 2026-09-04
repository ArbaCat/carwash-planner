// Генератор иконок PWA: синий квадрат с силуэтом машины сверху, без текста.
// Запуск:  node scripts/make-icons.mjs
// Пишет icons/icon-{180,192,512}.png. Внешних зависимостей нет — zlib из Node.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BG    = [0x2f, 0x7d, 0xe1];   // акцент
const BODY  = [0xf4, 0xf7, 0xfa];   // кузов
const GLASS = [0x9c, 0xc2, 0xf0];   // стёкла
const TYRE  = [0x24, 0x2b, 0x33];   // колёса

/** Точка внутри прямоугольника со скруглением r? Координаты 0..1. */
function inRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  if (px >= x0 + r && px <= x1 - r && py >= y0 && py <= y1) return true;
  if (py >= y0 + r && py <= y1 - r && px >= x0 && px <= x1) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/** Цвет одной подвыборки в нормализованных координатах. */
function sample(u, v, maskable) {
  // фон: скруглённый квадрат (для maskable — во всё поле)
  const bgR = maskable ? 0 : 0.16;
  if (!inRoundRect(u, v, 0, 0, 1, 1, bgR)) return null;

  // машина смотрит вверх, в безопасной зоне 80%
  const s = maskable ? 0.72 : 0.86;          // масштаб силуэта
  const x = (u - 0.5) / s + 0.5;
  const y = (v - 0.5) / s + 0.5;

  // колёса — чуть шире кузова
  const wheels = [
    [0.235, 0.255, 0.335, 0.375],
    [0.665, 0.255, 0.765, 0.375],
    [0.235, 0.625, 0.335, 0.745],
    [0.665, 0.625, 0.765, 0.745],
  ];
  for (const [a, b, c, d] of wheels) {
    if (inRoundRect(x, y, a, b, c, d, 0.028)) return TYRE;
  }

  // кузов
  if (inRoundRect(x, y, 0.285, 0.10, 0.715, 0.90, 0.10)) {
    // лобовое и заднее стёкла + крыша
    if (inRoundRect(x, y, 0.325, 0.215, 0.675, 0.335, 0.05)) return GLASS;
    if (inRoundRect(x, y, 0.325, 0.665, 0.675, 0.775, 0.05)) return GLASS;
    return BODY;
  }
  return BG;
}

function render(size, maskable = false) {
  const SS = 3;                              // сглаживание супервыборкой
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (pxi + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          const c = sample(u, v, maskable);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS, o = (py * size + pxi) * 4;
      if (a > 0) {
        // цвет — среднее по покрытым подвыборкам, альфа — по доле покрытия
        const cov = a / (255 * n);
        px[o]     = Math.round(r / (a / 255));
        px[o + 1] = Math.round(g / (a / 255));
        px[o + 2] = Math.round(b / (a / 255));
        px[o + 3] = Math.round(cov * 255);
      }
    }
  }
  return px;
}

// ---- минимальный писатель PNG (RGBA, 8 бит) ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // бит на канал
  ihdr[9] = 6;    // RGBA
  // 10..12 — сжатие/фильтр/интерлейс = 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // фильтр None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('icons', { recursive: true });
for (const [size, maskable] of [[180, false], [192, false], [512, true]]) {
  const file = `icons/icon-${size}.png`;
  writeFileSync(file, png(size, render(size, maskable)));
  console.log(`${file}  ${size}x${size}${maskable ? '  (maskable)' : ''}`);
}
