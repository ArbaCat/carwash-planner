// Действия над объектами и расчёт состояния подсветки.
// Математика берётся из geometry.js, DOM здесь не трогается.

import * as G from './geometry.js';
import { makeObject, byKey } from './catalog.js';

const SEV = { ok: 0, warn: 1, bad: 2 };
const worse = (a, b) => (SEV[a] >= SEV[b] ? a : b);

/** Зона обслуживания объекта как раздутая подошва, или сам объект. */
const zone = (o) => (o.clearance?.on && o.clearance.margin > 0
  ? G.expandObb(o, o.clearance.margin) : null);

/** Красный — объект вылез за стены. */
const selfFlag = (o, poly) => (G.footprintInsideRoom(o, poly) ? 'ok' : 'bad');

/** Как относятся друг к другу два объекта: наезд — красный,
 *  пересечение только зон обслуживания — оранжевый. */
function pairFlag(a, b) {
  if (G.obbOverlap(a, b)) return 'bad';
  const za = zone(a), zb = zone(b);
  if (!za && !zb) return 'ok';
  if (G.obbOverlap(za || a, zb || b)) return 'warn';
  return 'ok';
}

/** Полный пересчёт: O(n²), но только когда данные реально поменялись. */
export function computeFlags(objects, poly, skipId = null) {
  const list = objects.filter((o) => o.id !== skipId);
  const f = new Map(list.map((o) => [o.id, selfFlag(o, poly)]));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const r = pairFlag(list[i], list[j]);
      if (r === 'ok') continue;
      f.set(list[i].id, worse(f.get(list[i].id), r));
      f.set(list[j].id, worse(f.get(list[j].id), r));
    }
  }
  if (skipId) f.set(skipId, 'ok');
  return f;
}

/** Пересчёт на драге: O(n). База считается один раз на старте жеста и
 *  не содержит перемещаемый объект, поэтому на каждом кадре остаётся
 *  сравнить только его с остальными — как требует ТЗ. */
export function flagsWithMoving(objects, poly, movingId, base) {
  const o = objects.find((x) => x.id === movingId);
  if (!o) return new Map(base);
  const f = new Map(base);
  let mine = selfFlag(o, poly);
  for (const p of objects) {
    if (p.id === o.id) continue;
    const r = pairFlag(o, p);
    f.set(p.id, r === 'ok' ? (base.get(p.id) ?? 'ok') : worse(base.get(p.id) ?? 'ok', r));
    mine = worse(mine, r);
  }
  f.set(o.id, mine);
  return f;
}

/** Свободное место рядом с точкой: раскручиваем спираль, пока подошва не
 *  встанет в комнату без наезда. 20 попыток, дальше ставим как есть. */
export function freeSpot(objects, poly, proto, x0, y0) {
  const fits = (x, y) => {
    const t = { ...proto, x, y };
    if (!G.footprintInsideRoom(t, poly)) return false;
    return !objects.some((p) => G.obbOverlap(t, p));
  };
  if (fits(x0, y0)) return [x0, y0];

  // Шаг спирали считаем от размера комнаты: за отведённые 20 попыток она
  // должна успеть обойти всю комнату, а не топтаться вокруг центра.
  const b = G.polygonBounds(poly);
  const step = Math.max(40, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 12);

  for (let i = 1; i <= 20; i++) {
    const a = i * 2.399963;                 // золотой угол — витки не наслаиваются
    const r = step * Math.sqrt(i);
    const x = G.snap(x0 + Math.cos(a) * r, 10);
    const y = G.snap(y0 + Math.sin(a) * r, 10);
    if (fits(x, y)) return [x, y];
  }
  return [x0, y0];
}

/** Действия над объектами. ctx даёт доступ к состоянию и перерисовке. */
export function createObjectActions(ctx) {
  const { state, ui, commit, uid, select, viewCenter } = ctx;
  const find = (id) => state.scene.objects.find((o) => o.id === id);

  return {
    addObject(key) {
      const c = viewCenter();
      const proto = makeObject(key, 'tmp', c.x, c.y);
      if (!proto) return;
      const [x, y] = freeSpot(state.scene.objects, state.scene.room.vertices, proto, c.x, c.y);
      const o = { ...proto, id: uid('o'), x, y };
      const fromCatalog = ui.panel === 'add';
      state.scene.objects = [...state.scene.objects, o];
      select(o.id);
      // Каталог остаётся открытым: расставить бус, две легковые, пылесос и
      // стеллаж — это пять тапов, а не пять открытий панели. Объект при этом
      // всё равно выбран, ручка поворота и габариты под рукой.
      // Панель не перерисовываем: каталог от сцены не зависит, а пересборка
      // сбрасывала бы прокрутку — добавил бус, доскроллил до стеллажа, и
      // список прыгнул обратно наверх.
      if (fromCatalog) ui.panel = 'add';
      commit({ panel: !fromCatalog });
    },

    patch(id, fields) {
      state.scene.objects = state.scene.objects.map((o) => (o.id === id ? { ...o, ...fields } : o));
      // размер меняется вокруг центра — объект остаётся на месте
      commit({ panel: 'color' in fields || 'name' in fields ? false : true });
    },

    rotate(id, delta) {
      const o = find(id);
      if (!o) return;
      this.patch(id, { rot: (((o.rot + delta) % 360) + 360) % 360 });
    },

    duplicate(id) {
      const o = find(id);
      if (!o) return;
      const [x, y] = freeSpot(state.scene.objects, state.scene.room.vertices, o, o.x + 60, o.y + 60);
      const copy = { ...o, id: uid('o'), x, y, clearance: { ...o.clearance } };
      state.scene.objects = [...state.scene.objects, copy];
      select(copy.id);
      commit();
    },

    resetSize(id) {
      const o = find(id);
      const c = o && byKey(o.type);
      if (!c) return;
      this.patch(id, { l: c.l, w: c.w, h: c.h });
    },

    remove(id) {
      state.scene.objects = state.scene.objects.filter((o) => o.id !== id);
      if (state.selectedId === id) select(null);
      commit();
    },
  };
}
