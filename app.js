// Оркестрация: состояние, жесты, интерфейс.
// Математика — geometry.js, рендер — scene3d.js, панели — ui.js, тексты — strings.js.

import { createScene } from './scene3d.js';
import {
  buildRoom, buildWallOutline, buildEditHandles,
  buildObjects, moveObjectMesh, buildObjectOverlay, buildDimLines, rotateHandlePos,
} from './meshes.js';
import { createObjectActions, computeFlags } from './objects.js';
import { createGestures } from './gestures.js';
import * as G from './geometry.js';
import { S, fmtSize, fmtCmPlain } from './strings.js';
import * as UI from './ui.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  canvasHost: $('#canvas-host'),
  labelHost:  $('#label-host'),
  toolbar:    $('#toolbar'),
  sheet:      $('#sheet'),
  sheetGrab:  $('#sheet-grab'),
  sheetBody:  $('#sheet-body'),
  toastHost:  $('#toast-host'),
  variantName: $('#variant-name'),
  btnTop: $('#btn-view-top'), btn3d: $('#btn-view-3d'),
  btnAdd: $('#btn-add'), btnRoom: $('#btn-room'),
  btnVariants: $('#btn-variants'), btnMore: $('#btn-more'),
  btnUndo: $('#btn-undo'), btnRedo: $('#btn-redo'),
};

// ---- тач-гигиена -------------------------------------------------------

['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => {
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
});

let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 320 && e.target.closest('#stage')) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

el.canvasHost.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ---- тосты -------------------------------------------------------------

function toast(text, kind = '') {
  const node = UI.h('div', { class: 'toast' + (kind ? ' is-' + kind : ''), text });
  el.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

// ---- состояние ---------------------------------------------------------

const SNAP = 10;          // шаг привязки, см
const GRID = 50;

function defaultScene() {
  return {
    version: 1,
    name: S.variantA,
    updatedAt: new Date().toISOString(),
    room: {
      vertices: [[0, 0], [1200, 0], [1200, 600], [0, 600]],
      wallHeight: 350,
      gates: [{ id: 'g1', edgeIndex: 0, offset: 450, width: 300, label: S.gateDefaultLabel }],
    },
    objects: [],
  };
}

const state = { scene: defaultScene(), selectedId: null, flags: new Map() };
const ui = { panel: 'hint', wallEdit: false, gatePick: false, rectDraft: null, badVertex: -1 };

const uid = (p) => p + Math.random().toString(36).slice(2, 8);

// ---- сцена -------------------------------------------------------------

const sc = createScene({ canvasHost: el.canvasHost, labelHost: el.labelHost });
sc.onContextLost(() => toast(S.errWebgl, 'err'));

/** Свободный от тулбара и шторки прямоугольник канваса, в пикселях. */
function viewInsets() {
  const { w, h } = sc.getSize();
  const top = el.toolbar.getBoundingClientRect().height;
  const sh = el.sheet.getBoundingClientRect();
  if (window.innerWidth > 1000) return { top, bottom: 0, left: 0, right: Math.max(0, w - sh.left) };
  return { top, bottom: Math.max(0, h - sh.top), left: 0, right: 0 };
}

function fitScale() {
  const { w, h } = sc.getSize();
  const ins = viewInsets();
  const vw = Math.max(80, w - ins.left - ins.right);
  const vh = Math.max(80, h - ins.top - ins.bottom);
  const b = G.polygonBounds(state.scene.room.vertices);
  const rw = Math.max(50, b.maxX - b.minX), rh = Math.max(50, b.maxY - b.minY);
  return { ppc: Math.min(vw / (rw * 1.12), vh / (rh * 1.12)), ins, vw, vh, b };
}

const zoomLimits = () => {
  const f = fitScale().ppc;
  return { min: f * 0.8, max: 4 };
};

/** Вписать комнату в свободную часть кадра. */
function fitRoom() {
  const { ppc, ins, vw, vh, b } = fitScale();
  const { w, h } = sc.getSize();
  const vcx = ins.left + vw / 2, vcy = ins.top + vh / 2;
  const rcx = (b.minX + b.maxX) / 2, rcy = (b.minY + b.maxY) / 2;
  sc.setTopView(rcx - (vcx - w / 2) / ppc, rcy + (vcy - h / 2) / ppc, ppc);
  renderZoomDependent();
}

/** То, что зависит от масштаба: контур стен и ручки правки заданы в пикселях. */
function renderZoomDependent() {
  const ppc = sc.getTopView().pxPerCm;
  buildWallOutline(sc, state.scene.room, ppc);
  buildObjectOverlay(sc, state.scene, { selectedId: state.selectedId, flags: state.flags, pxPerCm: ppc });
  if (ui.wallEdit && sc.getMode() === 'top') {
    buildEditHandles(sc, state.scene.room, ppc, { badIndex: ui.badVertex });
  } else {
    sc.clear(sc.groups.gEdit);
    sc.requestRender();
  }
}

/** Подпись объекта: имя и Д×Ш. У мелких — только имя, иначе не читается.
 *  Собирается из узлов DOM, а не из innerHTML: имя вводит пользователь. */
function labelFor(o) {
  const small = Math.min(o.l, o.w) < 60;
  // Мелкий объект подпись накрывает целиком, поэтому у него она уезжает
  // выше — сдвигом в экранных координатах, а не в локальных: локальные
  // повернулись бы вместе с объектом.
  const cls = ['lbl'];
  if (state.flags.get(o.id) !== 'ok') cls.push('is-dim');
  if (small) cls.push('is-above');
  const node = UI.h('div', { class: cls.join(' ') }, o.name || '');
  if (!small) node.append(UI.h('small', { text: fmtSize(o.l, o.w) }));
  return node;
}

function renderScene() {
  const room = state.scene.room;
  const b = G.polygonBounds(room.vertices);
  sc.buildGrid(b.minX, b.minY, b.maxX, b.maxY);
  buildRoom(sc, room);
  state.flags = computeFlags(state.scene.objects, room.vertices);
  buildObjects(sc, state.scene, state.flags, labelFor);
  renderZoomDependent();
}

/** Центр свободной части кадра в координатах комнаты — сюда падают новые объекты. */
function viewCenter() {
  const { w, h } = sc.getSize();
  const ins = viewInsets();
  return sc.screenToRoom(
    ins.left + (w - ins.left - ins.right) / 2,
    ins.top + (h - ins.top - ins.bottom) / 2,
  );
}

function select(id) {
  state.selectedId = id;
  if (id) ui.panel = 'props';
  else if (ui.panel === 'props') ui.panel = 'hint';
}

/** Единая точка после любого изменения данных. Автосейв и undo сядут сюда. */
function commit({ rebuild = true, panel = true } = {}) {
  state.scene.updatedAt = new Date().toISOString();
  if (rebuild) renderScene();
  if (panel) renderPanel();
}

// ---- шторка и панели ---------------------------------------------------

const sheet = {
  open() { withReframe(() => { el.sheet.classList.remove('is-collapsed'); el.sheetGrab.setAttribute('aria-label', 'Свернуть панель'); }); },
  close() { withReframe(() => { el.sheet.classList.add('is-collapsed'); el.sheetGrab.setAttribute('aria-label', 'Развернуть панель'); }); },
  toggle() { el.sheet.classList.contains('is-collapsed') ? this.open() : this.close(); },
  isOpen() { return !el.sheet.classList.contains('is-collapsed'); },
};
el.sheetGrab.addEventListener('click', () => sheet.toggle());

/** Шторка меняет высоту — сдвигаем камеру на половину прироста, чтобы
 *  содержимое ушло вверх, а не спряталось под панелью. Масштаб не трогаем:
 *  сбрасывать зум пользователю на каждое открытие панели — злодейство.
 *
 *  Высота едет по transition, поэтому мерить сразу после смены класса нельзя —
 *  getBoundingClientRect отдаст середину анимации. Ждём transitionend. */
let reframeFrom = null;

function withReframe(mutate) {
  reframeFrom = el.sheet.getBoundingClientRect().top;
  mutate();
}

el.sheet.addEventListener('transitionend', (e) => {
  if (e.target !== el.sheet || e.propertyName !== 'height' || reframeFrom === null) return;
  const d = reframeFrom - el.sheet.getBoundingClientRect().top;
  reframeFrom = null;
  if (Math.abs(d) < 2 || window.innerWidth > 1000) return;
  const v = sc.getTopView();
  sc.setTopView(v.cx, v.cy - (d / 2) / v.pxPerCm);
});

/** Изменить раскладку шторки без анимации и получить итоговую геометрию сразу. */
function withoutTransition(mutate) {
  const prev = el.sheet.style.transition;
  el.sheet.style.transition = 'none';
  mutate();
  void el.sheet.offsetHeight;           // принудительный пересчёт раскладки
  el.sheet.style.transition = prev;
  reframeFrom = null;
}

function renderPanel() {
  UI.clear(el.sheetBody);
  let node;
  if (ui.panel === 'room') node = UI.renderRoomPanel(state.scene, A, ui);
  else if (ui.panel === 'add') node = UI.renderAddPanel(A);
  else if (ui.panel === 'props') node = UI.renderPropsPanel(selected(), A);
  else node = UI.renderHintPanel();
  el.sheetBody.appendChild(node);
  el.btnRoom.classList.toggle('is-on', ui.panel === 'room');
  el.btnAdd.classList.toggle('is-on', ui.panel === 'add');
}

function showPanel(name) {
  ui.panel = name;
  sheet.open();
  renderPanel();
}

// ---- действия над комнатой ---------------------------------------------

const selected = () => state.scene.objects.find((o) => o.id === state.selectedId) || null;

const A = {
  edgeLength(i) {
    const v = state.scene.room.vertices, n = v.length;
    const a = v[i], b = v[(i + 1) % n];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  },

  setWallHeight(v) {
    state.scene.room.wallHeight = v;
    commit({ panel: false });
  },

  applyRect(l, w) {
    const room = state.scene.room;
    room.vertices = [[0, 0], [l, 0], [l, w], [0, w]];
    // ворота ссылаются на индексы рёбер — оставляем только годные и подрезаем
    room.gates = (room.gates || [])
      .filter((g) => g.edgeIndex < 4)
      .map((g) => {
        const len = A.edgeLength(g.edgeIndex);
        const width = Math.min(g.width, len);
        return { ...g, width, offset: Math.min(g.offset, len - width) };
      });
    commit();
    fitRoom();
  },

  setWallEdit(on) {
    ui.wallEdit = on;
    ui.badVertex = -1;
    if (on) ui.gatePick = false;
    renderZoomDependent();
    renderPanel();
  },

  /** Двинуть вершину. false — так стены пересекутся, изменение не принято. */
  setVertex(i, axis, value) {
    const v = state.scene.room.vertices;
    const next = v.map((p) => [...p]);
    next[i][axis] = value;
    if (!G.polygonIsSimple(next)) { toast(S.errSelfIntersect, 'warn'); return false; }
    state.scene.room.vertices = next;
    commit();
    return true;
  },

  removeVertex(i) {
    const v = state.scene.room.vertices;
    if (v.length <= 3) { toast(S.errMinVertices, 'warn'); return; }
    const next = v.filter((_, k) => k !== i);
    if (!G.polygonIsSimple(next)) { toast(S.errSelfIntersect, 'warn'); return; }
    const room = state.scene.room;
    // рёбра после удалённой вершины сдвинулись — правим ссылки ворот
    room.gates = (room.gates || [])
      .filter((g) => g.edgeIndex !== i && g.edgeIndex !== (i - 1 + v.length) % v.length)
      .map((g) => ({ ...g, edgeIndex: g.edgeIndex > i ? g.edgeIndex - 1 : g.edgeIndex }));
    room.vertices = next;
    commit();
  },

  insertVertex(edgeIndex) {
    const room = state.scene.room;
    const v = room.vertices, n = v.length;
    const a = v[edgeIndex], b = v[(edgeIndex + 1) % n];
    const mid = [G.snap((a[0] + b[0]) / 2, SNAP), G.snap((a[1] + b[1]) / 2, SNAP)];
    room.vertices = [...v.slice(0, edgeIndex + 1), mid, ...v.slice(edgeIndex + 1)];
    room.gates = (room.gates || [])
      .filter((g) => g.edgeIndex !== edgeIndex)
      .map((g) => ({ ...g, edgeIndex: g.edgeIndex > edgeIndex ? g.edgeIndex + 1 : g.edgeIndex }));
    commit();
  },

  startGatePick() {
    ui.gatePick = true;
    ui.wallEdit = false;
    renderZoomDependent();
    renderPanel();
    toast(S.gatePickWall);
  },

  addGateAt(edgeIndex, t) {
    const len = A.edgeLength(edgeIndex);
    const width = Math.min(300, Math.max(30, len));
    const offset = Math.max(0, Math.min(len - width, t - width / 2));
    state.scene.room.gates = [...(state.scene.room.gates || []), {
      id: uid('g'), edgeIndex, offset: G.snap(offset, SNAP), width, label: S.gateDefaultLabel,
    }];
    ui.gatePick = false;
    commit();
  },

  setGate(id, patch) {
    state.scene.room.gates = state.scene.room.gates.map((g) => (g.id === id ? { ...g, ...patch } : g));
    commit({ panel: false });
  },

  removeGate(id) {
    state.scene.room.gates = state.scene.room.gates.filter((g) => g.id !== id);
    commit();
  },
};

Object.assign(A, createObjectActions({ state, ui, commit, uid, select, viewCenter }));

// ---- жесты -------------------------------------------------------------

const gestures = createGestures({
  sc, state, ui, A, toast, commit,
  renderScene, renderZoomDependent, zoomLimits, select, renderPanel,
});
gestures.attach(sc.renderer.domElement);

// ---- вид ---------------------------------------------------------------

function setView(mode) {
  sc.setMode(mode);
  el.btnTop.classList.toggle('is-on', mode === 'top');
  el.btn3d.classList.toggle('is-on', mode === '3d');
  el.btnTop.setAttribute('aria-selected', String(mode === 'top'));
  el.btn3d.setAttribute('aria-selected', String(mode === '3d'));
  renderZoomDependent();
}

// ---- ресайз ------------------------------------------------------------

function fitCanvas() {
  const r = el.canvasHost.getBoundingClientRect();
  const before = sc.getTopView();
  sc.resize(r.width, r.height);
  // масштаб держим, центр сохраняется сам — камера привязана к центру комнаты
  sc.setTopView(before.cx, before.cy, before.pxPerCm);
  renderZoomDependent();
}
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', () => setTimeout(() => { fitCanvas(); fitRoom(); }, 150));

// ---- старт -------------------------------------------------------------

function boot() {
  const r = el.canvasHost.getBoundingClientRect();
  sc.resize(r.width, r.height);
  el.variantName.textContent = state.scene.name;

  el.btnTop.addEventListener('click', () => setView('top'));
  el.btn3d.addEventListener('click', () => setView('3d'));
  el.btnRoom.addEventListener('click', () => showPanel(ui.panel === 'room' ? 'hint' : 'room'));
  el.btnAdd.addEventListener('click', () => showPanel(ui.panel === 'add' ? 'hint' : 'add'));

  renderScene();
  // сначала шторка, потом вписывание: fitRoom считает свободную часть кадра
  withoutTransition(() => showPanel('hint'));
  fitRoom();
}

boot();

// временный крючок для отладки
window.__cw = { sc, state, ui, A, commit, renderScene, fitRoom };
