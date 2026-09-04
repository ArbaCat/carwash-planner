// Жесты вида сверху: пан, пинч-зум, выбор, перетаскивание, поворот,
// правка стен. Мышь и клавиатура идут теми же путями, что и палец.
//
// Всё хит-тестится в координатах комнаты через screenToRoom, без рейкаста:
// вид сверху — ортографическая проекция, экран и план связаны линейно.

import * as G from './geometry.js';
import { S, fmtCmPlain } from './strings.js';
import {
  moveObjectMesh, buildObjectOverlay, buildDimLines, rotateHandlePos,
} from './meshes.js';
import { computeFlags, flagsWithMoving } from './objects.js';

const DRAG_PX = 6;      // до этого сдвига жест считается тапом
const HIT_PX = 24;      // радиус попадания в ручку — зона 48 px
const LONG_MS = 600;
const SNAP = 10;        // шаг привязки, см
const ROT_STEP = 15;    // шаг поворота ручкой, градусы

/** Захват указателя — это удобство: события продолжают идти, даже когда палец
 *  уехал за пределы канваса. Но браузер может отказать (указатель уже не
 *  активен), а исключение здесь убивало бы весь жест. Поэтому глушим. */
function capture(el, pointerId) {
  try { el.setPointerCapture?.(pointerId); } catch { /* обойдёмся без захвата */ }
}

export function createGestures(ctx) {
  const {
    sc, state, ui, A, toast, commit,
    renderScene, renderZoomDependent, zoomLimits, select, renderPanel,
  } = ctx;

  const ptrs = new Map();
  let gest = null;
  let longTimer = 0;
  let spaceDown = false, shiftDown = false;
  let cv = null;

  const poly = () => state.scene.room.vertices;
  const objs = () => state.scene.objects;
  const byId = (id) => objs().find((o) => o.id === id);
  const ppc = () => sc.getTopView().pxPerCm;
  const hitCm = () => HIT_PX / ppc();

  const localPt = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const roomAt = (p) => sc.screenToRoom(p.x, p.y);

  // ---- хит-тесты -------------------------------------------------------

  function hitVertex(rp) {
    const r = hitCm();
    let best = -1, bd = Infinity;
    poly().forEach(([x, y], i) => {
      const d = Math.hypot(rp.x - x, rp.y - y);
      if (d <= r && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function hitEdgeMid(rp) {
    const v = poly(), n = v.length, r = hitCm();
    for (let i = 0; i < n; i++) {
      const a = v[i], b = v[(i + 1) % n];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (Math.hypot(rp.x - m[0], rp.y - m[1]) <= r) return i;
    }
    return -1;
  }

  function hitRotateHandle(rp) {
    const o = byId(state.selectedId);
    if (!o) return false;
    const [hx, hy] = rotateHandlePos(o, ppc());
    return Math.hypot(rp.x - hx, rp.y - hy) <= hitCm();
  }

  /** Верхний объект под точкой. Мелким даём припуск, иначе пальцем не попасть. */
  function hitObject(rp) {
    const pad = 8 / ppc();
    const list = objs();
    for (let i = list.length - 1; i >= 0; i--) {
      if (G.pointInObb([rp.x, rp.y], list[i], pad)) return list[i].id;
    }
    return null;
  }

  // ---- камера ----------------------------------------------------------

  function applyPan(p) {
    const { w, h } = sc.getSize();
    const k = ppc();
    sc.setTopView(gest.anchor.x - (p.x - w / 2) / k, gest.anchor.y + (p.y - h / 2) / k);
  }

  function startPinch() {
    const [a, b] = [...ptrs.values()];
    clearTimeout(longTimer);
    gest = {
      kind: 'pinch',
      startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startPpc: ppc(),
      anchor: roomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    };
  }

  function applyPinch() {
    const pts = [...ptrs.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const lim = zoomLimits();
    const k = Math.min(lim.max, Math.max(lim.min,
      gest.startPpc * Math.hypot(a.x - b.x, a.y - b.y) / gest.startDist));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { w, h } = sc.getSize();
    sc.setTopView(gest.anchor.x - (mid.x - w / 2) / k, gest.anchor.y + (mid.y - h / 2) / k, k);
    renderZoomDependent();
  }

  function zoomAt(p, factor) {
    const lim = zoomLimits();
    const anchor = roomAt(p);
    const k = Math.min(lim.max, Math.max(lim.min, ppc() * factor));
    const { w, h } = sc.getSize();
    sc.setTopView(anchor.x - (p.x - w / 2) / k, anchor.y + (p.y - h / 2) / k, k);
    renderZoomDependent();
  }

  // ---- перетаскивание объекта -----------------------------------------

  function dragTo(rp) {
    const o = byId(gest.objId);
    if (!o) return;
    o.x = G.snap(rp.x - gest.grab.dx, SNAP);
    o.y = G.snap(rp.y - gest.grab.dy, SNAP);
    afterObjectMove(o);
  }

  function rotateTo(rp) {
    const o = byId(gest.objId);
    if (!o) return;
    let deg = Math.atan2(rp.y - o.y, rp.x - o.x) * 180 / Math.PI;
    if (!shiftDown) deg = G.snap(deg, ROT_STEP);
    o.rot = ((Math.round(deg) % 360) + 360) % 360;
    afterObjectMove(o, false);
  }

  function afterObjectMove(o, withDims = true) {
    state.flags = flagsWithMoving(objs(), poly(), o.id, gest.base);
    moveObjectMesh(sc, o, state.flags.get(o.id));
    buildObjectOverlay(sc, state.scene, {
      selectedId: state.selectedId, flags: state.flags, pxPerCm: ppc(),
    });
    if (withDims) buildDimLines(sc, o, G.distanceToWalls(o, poly()), ppc(), fmtCmPlain);
  }

  function endObjectGesture() {
    buildDimLines(sc, null);
    gest = null;
    commit();
  }

  // ---- драг объекта в 3D ----------------------------------------------

  // Ловим в фазе перехвата, раньше OrbitControls: палец на объекте — это
  // перетаскивание, палец на пустом — орбита. stopPropagation держит орбиту
  // в стороне, не выключая её, — иначе потерянный pointerup оставил бы
  // орбиту мёртвой навсегда.
  let g3 = null;

  function on3dDown(e) {
    if (sc.getMode() !== '3d' || g3) return;
    const p = localPt(e);
    const id = sc.pickObject3d(p.x, p.y);
    if (!id) return;
    const f = sc.screenToFloor(p.x, p.y);
    const o = byId(id);
    if (!f || !o) return;

    e.stopPropagation();
    capture(cv, e.pointerId);
    g3 = {
      id: e.pointerId, objId: id,
      grab: { dx: f.x - o.x, dy: f.y - o.y },
      base: computeFlags(objs(), poly(), id),
    };
    if (state.selectedId !== id) { select(id); renderPanel(); }
  }

  function on3dMove(e) {
    if (!g3 || e.pointerId !== g3.id) return;
    e.stopPropagation();
    const p = localPt(e);
    const f = sc.screenToFloor(p.x, p.y);
    const o = byId(g3.objId);
    if (!f || !o) return;
    o.x = G.snap(f.x - g3.grab.dx, SNAP);
    o.y = G.snap(f.y - g3.grab.dy, SNAP);
    state.flags = flagsWithMoving(objs(), poly(), o.id, g3.base);
    moveObjectMesh(sc, o, state.flags.get(o.id));
    buildObjectOverlay(sc, state.scene, {
      selectedId: state.selectedId, flags: state.flags, pxPerCm: ppc(), mode: '3d',
    });
    buildDimLines(sc, o, G.distanceToWalls(o, poly()), ppc(), fmtCmPlain, '3d');
  }

  function on3dUp(e) {
    if (!g3 || e.pointerId !== g3.id) return;
    e.stopPropagation();
    g3 = null;
    buildDimLines(sc, null);
    commit();
  }

  // ---- события ---------------------------------------------------------

  function onDown(e) {
    if (sc.getMode() !== 'top') return;
    capture(cv, e.pointerId);
    const p = localPt(e);
    ptrs.set(e.pointerId, p);

    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;

    if (e.pointerType === 'mouse' && (e.button === 2 || spaceDown)) {
      gest = { kind: 'pan', id: e.pointerId, start: p, anchor: roomAt(p) };
      return;
    }

    const rp = roomAt(p);

    if (ui.wallEdit) {
      const vi = hitVertex(rp);
      if (vi >= 0) {
        gest = {
          kind: 'vertex', id: e.pointerId, start: p, index: vi,
          origin: [...poly()[vi]], moved: false, armed: false,
        };
        // Долгий тап не удаляет сразу, а взводит удаление: вершина краснеет,
        // сдвиг пальца отменяет. Иначе неуверенный драг (нажал, подумал,
        // повёл) молча съедает вершину, а это необратимое действие.
        longTimer = setTimeout(() => {
          if (gest?.kind !== 'vertex' || gest.moved) return;
          gest.armed = true;
          ui.badVertex = gest.index;
          renderZoomDependent();
          toast(S.releaseToDelete, 'warn');
        }, LONG_MS);
        return;
      }
      const mi = hitEdgeMid(rp);
      if (mi >= 0) { gest = { kind: 'addvertex', id: e.pointerId, start: p, edge: mi }; return; }
      gest = { kind: 'maybe', id: e.pointerId, start: p };
      return;
    }

    if (hitRotateHandle(rp)) {
      gest = {
        kind: 'rot', id: e.pointerId, start: p, objId: state.selectedId,
        base: computeFlags(objs(), poly(), state.selectedId), moved: false,
      };
      return;
    }

    const oid = hitObject(rp);
    if (oid) {
      const o = byId(oid);
      gest = {
        kind: 'objmaybe', id: e.pointerId, start: p, objId: oid,
        grab: { dx: rp.x - o.x, dy: rp.y - o.y }, moved: false,
      };
      return;
    }

    gest = { kind: 'maybe', id: e.pointerId, start: p };
  }

  function onMove(e) {
    if (!ptrs.has(e.pointerId)) return;
    const p = localPt(e);
    ptrs.set(e.pointerId, p);

    if (gest?.kind === 'pinch') { applyPinch(); return; }
    if (!gest || gest.id !== e.pointerId) return;

    const moved = Math.hypot(p.x - gest.start.x, p.y - gest.start.y);

    if (gest.kind === 'maybe') {
      if (moved < DRAG_PX) return;
      gest = { kind: 'pan', id: e.pointerId, start: gest.start, anchor: roomAt(gest.start) };
    }

    if (gest.kind === 'pan') { applyPan(p); return; }

    if (gest.kind === 'objmaybe') {
      if (moved < DRAG_PX) return;
      // объект берём в работу только сейчас — до этого это был возможный тап
      if (state.selectedId !== gest.objId) { select(gest.objId); renderPanel(); }
      gest = {
        ...gest, kind: 'obj', moved: true,
        base: computeFlags(objs(), poly(), gest.objId),
      };
    }

    if (gest.kind === 'obj') { dragTo(roomAt(p)); return; }

    if (gest.kind === 'rot') {
      if (moved > DRAG_PX) gest.moved = true;
      if (gest.moved) rotateTo(roomAt(p));
      return;
    }

    if (gest.kind === 'vertex') {
      if (moved > DRAG_PX) {
        gest.moved = true;
        clearTimeout(longTimer);
        if (gest.armed) { gest.armed = false; ui.badVertex = -1; }
      }
      if (!gest.moved) return;
      const rp = roomAt(p);
      const next = poly().map((q) => [...q]);
      next[gest.index] = [G.snap(rp.x, SNAP), G.snap(rp.y, SNAP)];
      const ok = G.polygonIsSimple(next);
      state.scene.room.vertices = next;
      ui.badVertex = ok ? -1 : gest.index;
      renderScene();
      return;
    }

    if (gest.kind === 'addvertex' && moved > DRAG_PX) gest = null;
  }

  function onUp(e) {
    const p = ptrs.get(e.pointerId) || localPt(e);
    ptrs.delete(e.pointerId);
    clearTimeout(longTimer);

    if (gest?.kind === 'pinch') { if (ptrs.size < 2) gest = null; return; }
    if (!gest || gest.id !== e.pointerId) { if (!ptrs.size) gest = null; return; }

    switch (gest.kind) {
      case 'vertex': {
        if (gest.armed) {
          const i = gest.index;
          gest = null; ui.badVertex = -1;
          A.removeVertex(i);
          return;
        }
        if (gest.moved && ui.badVertex === gest.index) {
          // отпустили там, где стены пересекаются — возвращаем как было
          const v = poly().map((q) => [...q]);
          v[gest.index] = gest.origin;
          state.scene.room.vertices = v;
          toast(S.errSelfIntersect, 'warn');
        }
        ui.badVertex = -1;
        gest = null;
        commit();
        return;
      }
      case 'addvertex': { const i = gest.edge; gest = null; A.insertVertex(i); return; }
      case 'obj': endObjectGesture(); return;
      case 'rot': {
        if (!gest.moved) { gest = null; return; }
        endObjectGesture();
        return;
      }
      case 'objmaybe': {
        const id = gest.objId;
        gest = null;
        select(id);
        renderZoomDependent();
        renderPanel();
        return;
      }
      case 'maybe': { gest = null; onTap(roomAt(p)); return; }
      default: gest = null;
    }
  }

  function onTap(rp) {
    if (ui.gatePick) {
      const e = G.nearestEdge([rp.x, rp.y], poly());
      if (e) A.addGateAt(e.index, e.t);
      return;
    }
    if (ui.wallEdit) return;          // в правке стен объекты не выбираются
    if (state.selectedId) {
      select(null);
      renderZoomDependent();
      renderPanel();
    }
  }

  function onWheel(e) {
    if (sc.getMode() !== 'top') return;
    e.preventDefault();
    zoomAt(localPt(e), Math.exp(-e.deltaY * 0.0015));
  }

  function onKey(e) {
    // target не всегда элемент: у события, отправленного на window, closest нет
    if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
    if (e.code === 'Space') { spaceDown = true; return; }

    // отмена работает и без выделения, поэтому раньше проверки на объект
    if ((e.metaKey || e.ctrlKey) && 'zZяЯ'.includes(e.key)) {
      e.preventDefault();
      if (e.shiftKey) A.redo(); else A.undo();
      return;
    }

    const id = state.selectedId;
    if (!id) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); A.remove(id); return; }
    if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') { A.rotate(id, 90); return; }
    if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') { A.duplicate(id); }
  }

  return {
    attach(canvas) {
      cv = canvas;
      cv.addEventListener('pointerdown', on3dDown, true);
      cv.addEventListener('pointermove', on3dMove, true);
      cv.addEventListener('pointerup', on3dUp, true);
      cv.addEventListener('pointercancel', on3dUp, true);
      cv.addEventListener('pointerdown', onDown);
      cv.addEventListener('pointermove', onMove);
      cv.addEventListener('pointerup', onUp);
      cv.addEventListener('pointercancel', onUp);
      cv.addEventListener('wheel', onWheel, { passive: false });
      cv.addEventListener('contextmenu', (ev) => ev.preventDefault());
      window.addEventListener('keydown', (ev) => { shiftDown = ev.shiftKey; onKey(ev); });
      window.addEventListener('keyup', (ev) => {
        shiftDown = ev.shiftKey;
        if (ev.code === 'Space') spaceDown = false;
      });
    },
  };
}
