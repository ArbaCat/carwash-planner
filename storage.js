// localStorage, варианты, история отмен, проверка сцены на импорте.
// Ничего не уходит в сеть — только браузер и файлы экспорта.

import { normalizePolygon } from './geometry.js';

export const KEY = 'carwash-planner:v1';
export const VERSION = 1;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pos = (v) => num(v) && v > 0;

/** Проверка по схеме из ТЗ. Возвращает { ok, error } или { ok, scene }. */
export function validateScene(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'shape' };
  if (raw.version !== VERSION) return { ok: false, error: 'version', version: raw.version };

  const room = raw.room;
  if (!room || typeof room !== 'object') return { ok: false, error: 'shape' };
  if (!Array.isArray(room.vertices) || room.vertices.length < 3) return { ok: false, error: 'shape' };
  for (const v of room.vertices) {
    if (!Array.isArray(v) || v.length !== 2 || !num(v[0]) || !num(v[1])) return { ok: false, error: 'shape' };
  }
  if (!pos(room.wallHeight)) return { ok: false, error: 'shape' };

  const gates = Array.isArray(room.gates) ? room.gates : [];
  for (const g of gates) {
    if (!g || typeof g !== 'object') return { ok: false, error: 'shape' };
    if (!Number.isInteger(g.edgeIndex) || g.edgeIndex < 0 || g.edgeIndex >= room.vertices.length) {
      return { ok: false, error: 'shape' };
    }
    if (!num(g.offset) || !pos(g.width)) return { ok: false, error: 'shape' };
  }

  if (!Array.isArray(raw.objects)) return { ok: false, error: 'shape' };
  for (const o of raw.objects) {
    if (!o || typeof o !== 'object') return { ok: false, error: 'shape' };
    if (!num(o.x) || !num(o.y) || !num(o.rot)) return { ok: false, error: 'shape' };
    if (!pos(o.l) || !pos(o.w) || !pos(o.h)) return { ok: false, error: 'shape' };
  }

  // приводим к каноническому виду: обход против часовой, поля на местах
  const scene = {
    version: VERSION,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Вариант',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    room: {
      vertices: normalizePolygon(room.vertices.map((v) => [v[0], v[1]])),
      wallHeight: room.wallHeight,
      gates: gates.map((g, i) => ({
        id: typeof g.id === 'string' ? g.id : `g${i + 1}`,
        edgeIndex: g.edgeIndex, offset: g.offset, width: g.width,
        label: typeof g.label === 'string' ? g.label : '',
      })),
    },
    objects: raw.objects.map((o, i) => ({
      id: typeof o.id === 'string' ? o.id : `o${i + 1}`,
      type: typeof o.type === 'string' ? o.type : 'box',
      name: typeof o.name === 'string' ? o.name : 'Объект',
      x: o.x, y: o.y, rot: o.rot, l: o.l, w: o.w, h: o.h,
      color: typeof o.color === 'string' ? o.color : '#8A8F98',
      opacity: num(o.opacity) ? Math.min(1, Math.max(0.05, o.opacity)) : 1,
      clearance: {
        on: !!o.clearance?.on,
        margin: pos(o.clearance?.margin) ? o.clearance.margin : 80,
      },
    })),
  };
  return { ok: true, scene };
}

/** Хранилище вариантов. Если localStorage недоступен — живём в памяти. */
export function createStorage({ onQuota, onUnavailable } = {}) {
  let available = true;
  try {
    const probe = '__cw_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    available = false;
    onUnavailable?.();
  }

  let memory = null;          // запасной ящик, когда localStorage закрыт
  let timer = 0;

  function readRaw() {
    if (!available) return memory;
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  }

  function writeRaw(data) {
    memory = data;
    if (!available) return true;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) onQuota?.();
      return false;
    }
  }

  return {
    isAvailable: () => available,

    /** { activeId, variants:[{id, scene}] } или null. Битые варианты отбрасываем. */
    load() {
      const raw = readRaw();
      if (!raw || !Array.isArray(raw.variants)) return null;
      const variants = [];
      for (const v of raw.variants) {
        const r = validateScene(v?.scene);
        if (r.ok && typeof v.id === 'string') variants.push({ id: v.id, scene: r.scene });
      }
      if (!variants.length) return null;
      const activeId = variants.some((v) => v.id === raw.activeId) ? raw.activeId : variants[0].id;
      return { activeId, variants };
    },

    /** Дебаунс 300 мс: драг зовёт сохранение часто, писать на каждый кадр незачем. */
    save(store) {
      clearTimeout(timer);
      timer = setTimeout(() => writeRaw(store), 300);
    },

    saveNow(store) {
      clearTimeout(timer);
      return writeRaw(store);
    },

    clear() {
      memory = null;
      if (available) { try { localStorage.removeItem(KEY); } catch { /* не судьба */ } }
    },
  };
}

/** Стек снапшотов сцены. Своя история у каждого варианта.
 *  updatedAt в сравнении не участвует: он меняется на каждом сохранении,
 *  иначе в историю сыпались бы записи о том, что ничего не изменилось. */
export function createHistory(depth = 100) {
  const per = new Map();     // id варианта -> { past, future, last, lastKey }

  const keyOf = (scene) => {
    const { updatedAt, ...rest } = scene;
    return JSON.stringify(rest);
  };

  const box = (id) => {
    if (!per.has(id)) per.set(id, { past: [], future: [], last: null, lastKey: null });
    return per.get(id);
  };

  const mark = (b, scene) => {
    b.last = JSON.stringify(scene);
    b.lastKey = keyOf(scene);
  };

  return {
    /** Задать отправную точку и стереть историю варианта. */
    reset(id, scene) {
      const b = box(id);
      b.past.length = 0; b.future.length = 0;
      mark(b, scene);
    },

    /** Задать отправную точку, только если варианта ещё не видели. */
    ensure(id, scene) {
      const b = box(id);
      if (b.last === null) mark(b, scene);
    },

    /** Зафиксировать изменение: в историю уходит состояние ДО него. */
    push(id, scene) {
      const b = box(id);
      if (b.lastKey === keyOf(scene)) return false;
      if (b.last !== null) {
        b.past.push(b.last);
        if (b.past.length > depth) b.past.shift();
      }
      b.future.length = 0;
      mark(b, scene);
      return true;
    },

    canUndo(id) { return box(id).past.length > 0; },
    canRedo(id) { return box(id).future.length > 0; },

    undo(id) {
      const b = box(id);
      if (!b.past.length) return null;
      b.future.push(b.last);
      b.last = b.past.pop();
      b.lastKey = keyOf(JSON.parse(b.last));
      return JSON.parse(b.last);
    },

    redo(id) {
      const b = box(id);
      if (!b.future.length) return null;
      b.past.push(b.last);
      b.last = b.future.pop();
      b.lastKey = keyOf(JSON.parse(b.last));
      return JSON.parse(b.last);
    },

    drop(id) { per.delete(id); },
  };
}
