// Пресеты. Размеры — сантиметры, Д × Ш × В.
// Это только значения по умолчанию: после добавления габариты живут в самом
// объекте, а не в каталоге, и правятся у каждого экземпляра отдельно.

export const PALETTE = [
  '#4A7BD0', // синий
  '#3FA06B', // зелёный
  '#D97C2B', // оранжевый
  '#B8524F', // терракота
  '#7A5FBF', // фиолетовый
  '#2FA3A8', // бирюзовый
  '#8A8F98', // серый
  '#C9A227', // жёлтый
];

export const GROUPS = [
  { key: 'cars',  title: 'Транспорт' },
  { key: 'equip', title: 'Оборудование' },
  { key: 'other', title: 'Прочее' },
];

/** clearance — отступ зоны обслуживания в см; 0 значит «выключена». */
export const CATALOG = [
  { key: 'car_sedan', name: 'Легковая',       group: 'cars',  l: 460, w: 180, h: 150, clearance: 80, color: PALETTE[0], note: 'Octavia combi' },
  { key: 'car_suv',   name: 'Кроссовер',      group: 'cars',  l: 470, w: 190, h: 170, clearance: 80, color: PALETTE[0] },
  { key: 'van',       name: 'Бус',            group: 'cars',  l: 500, w: 195, h: 200, clearance: 80, color: PALETTE[4], note: 'Transporter L1' },
  { key: 'van_long',  name: 'Бус длинный',    group: 'cars',  l: 530, w: 195, h: 200, clearance: 80, color: PALETTE[4], note: 'L2' },
  { key: 'moto',      name: 'Мотоцикл',       group: 'cars',  l: 220, w: 80,  h: 120, clearance: 60, color: PALETTE[3] },

  { key: 'vacuum',     name: 'Пылесос',        group: 'equip', l: 60,  w: 60,  h: 180, clearance: 0, color: PALETTE[1] },
  { key: 'shelf',      name: 'Стеллаж',        group: 'equip', l: 100, w: 40,  h: 200, clearance: 0, color: PALETTE[6] },
  { key: 'table',      name: 'Стол',           group: 'equip', l: 120, w: 60,  h: 90,  clearance: 0, color: PALETTE[7] },
  { key: 'tank',       name: 'Бак',            group: 'equip', l: 100, w: 100, h: 150, clearance: 0, color: PALETTE[5] },
  { key: 'water_unit', name: 'Водоподготовка', group: 'equip', l: 60,  w: 60,  h: 180, clearance: 0, color: PALETTE[5] },

  { key: 'partition', name: 'Перегородка', group: 'other', l: 300, w: 5,   h: 250, clearance: 0, color: PALETTE[6] },
  { key: 'curtain',   name: 'Штора',       group: 'other', l: 300, w: 5,   h: 250, clearance: 0, color: PALETTE[5], opacity: 0.4 },
  { key: 'box',       name: 'Бокс',        group: 'other', l: 100, w: 100, h: 100, clearance: 0, color: PALETTE[6] },
];

const BY_KEY = new Map(CATALOG.map((c) => [c.key, c]));
export const byKey = (key) => BY_KEY.get(key) || null;

/** Новый объект сцены из пресета. */
export function makeObject(key, id, x, y) {
  const c = byKey(key);
  if (!c) return null;
  return {
    id, type: key, name: c.name,
    x, y, rot: 0,
    l: c.l, w: c.w, h: c.h,
    color: c.color,
    opacity: c.opacity ?? 1,
    clearance: { on: c.clearance > 0, margin: c.clearance || 80 },
  };
}

/** Иконка карточки: вид сверху в пропорциях самого объекта — заодно сразу
 *  видно, что бус длиннее легковой, а стеллаж узкий. */
export function iconSvg(c) {
  const W = 56, H = 40, pad = 3;
  const k = Math.min((W - pad * 2) / c.l, (H - pad * 2) / c.w);
  const w = Math.max(3, c.l * k), h = Math.max(3, c.w * k);
  const x = (W - w) / 2, y = (H - h) / 2;
  const r = Math.min(4, h / 2.5);
  const isCar = c.group === 'cars';
  const glass = isCar
    ? `<rect x="${x + w * 0.14}" y="${y + h * 0.18}" width="${w * 0.16}" height="${h * 0.64}" rx="2" fill="rgba(255,255,255,.55)"/>
       <rect x="${x + w * 0.66}" y="${y + h * 0.18}" width="${w * 0.14}" height="${h * 0.64}" rx="2" fill="rgba(255,255,255,.55)"/>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"
          fill="${c.color}" fill-opacity="${c.opacity ?? 1}" stroke="rgba(0,0,0,.35)"/>
    ${glass}
  </svg>`;
}
