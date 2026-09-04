// Оркестрация: состояние, жесты, интерфейс.
// Математика — geometry.js, рендер — scene3d.js, панели — ui.js, тексты — strings.js.

import { createScene } from './scene3d.js';
import {
  buildRoom, buildWallOutline, buildEditHandles,
  buildObjects, moveObjectMesh, buildObjectOverlay, buildDimLines, rotateHandlePos,
} from './meshes.js';
import { createObjectActions, computeFlags } from './objects.js';
import { createGestures } from './gestures.js';
import { createStorage, createHistory } from './storage.js';
import { createRoomActions, createShellActions } from './actions.js';
import * as IO from './io.js';
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

const storage = createStorage({
  onQuota: () => toast(S.errQuota, 'err'),
  onUnavailable: () => toast(S.errNoStorage, 'warn'),
});
const history = createHistory(100);

const store = { activeId: 'v1', variants: [{ id: 'v1', scene: defaultScene() }] };
const state = { scene: store.variants[0].scene, selectedId: null, flags: new Map() };

const activeVariant = () => store.variants.find((v) => v.id === store.activeId);

function nextVariantName() {
  const used = new Set(store.variants.map((v) => v.scene.name));
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const name = `${S.variantPrefix} ${ch}`;
    if (!used.has(name)) return name;
  }
  return `${S.variantPrefix} ${store.variants.length + 1}`;
}
const ui = { panel: 'hint', wallEdit: false, gatePick: false, rectDraft: null, badVertex: -1 };

const uid = (p) => p + Math.random().toString(36).slice(2, 8);

// ---- сцена -------------------------------------------------------------

const sc = createScene({ canvasHost: el.canvasHost, labelHost: el.labelHost });
sc.onContextLost(() => toast(S.errWebgl, 'err'));
sc.onInsets(() => viewInsets());

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
  buildObjectOverlay(sc, state.scene, {
    selectedId: state.selectedId, flags: state.flags, pxPerCm: ppc, mode: sc.getMode(),
  });
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

function updateUndoButtons() {
  el.btnUndo.disabled = !history.canUndo(store.activeId);
  el.btnRedo.disabled = !history.canRedo(store.activeId);
}

/** Единая точка после любого изменения данных: история, автосейв, перерисовка.
 *  Один драг = одна запись в историю, потому что commit зовётся на pointerup,
 *  а не на каждом движении. */
function commit({ rebuild = true, panel = true } = {}) {
  state.scene.updatedAt = new Date().toISOString();
  history.push(store.activeId, state.scene);
  storage.save(store);
  updateUndoButtons();
  if (rebuild) renderScene();
  if (panel) renderPanel();
}

/** Подставить сцену целиком — отмена, возврат, импорт, переключение варианта. */
function applyScene(scene) {
  activeVariant().scene = scene;
  state.scene = scene;
  if (!scene.objects.some((o) => o.id === state.selectedId)) select(null);
  el.variantName.textContent = scene.name;
  storage.save(store);
  updateUndoButtons();
  renderScene();
  renderPanel();
}

// ---- шторка и панели ---------------------------------------------------

const sheet = {
  open() { withReframe(() => { el.sheet.classList.remove('is-collapsed'); el.sheetGrab.setAttribute('aria-label', 'Свернуть панель'); }); },
  close() { withReframe(() => { el.sheet.classList.add('is-collapsed'); el.sheetGrab.setAttribute('aria-label', 'Развернуть панель'); }); },
  toggle() { el.sheet.classList.contains('is-collapsed') ? this.open() : this.close(); },
  isOpen() { return !el.sheet.classList.contains('is-collapsed'); },
};
// Шторка открывается тапом и свайпом. Свайп ловим на самой ручке: канвас
// свои жесты обрабатывает сам, и мешать им незачем.
let grabDrag = null;
let swipedAt = 0;

el.sheetGrab.addEventListener('pointerdown', (e) => {
  grabDrag = { y: e.clientY, open: sheet.isOpen() };
});
el.sheetGrab.addEventListener('pointermove', (e) => {
  if (!grabDrag) return;
  const dy = e.clientY - grabDrag.y;
  if (Math.abs(dy) < 24) return;
  if (dy < 0 && !grabDrag.open) { sheet.open(); swipedAt = Date.now(); grabDrag = null; }
  else if (dy > 0 && grabDrag.open) { sheet.close(); swipedAt = Date.now(); grabDrag = null; }
});
el.sheetGrab.addEventListener('pointerup', () => { grabDrag = null; });
el.sheetGrab.addEventListener('pointercancel', () => { grabDrag = null; });

el.sheetGrab.addEventListener('click', () => {
  if (Date.now() - swipedAt < 400) return;   // свайп уже всё сделал
  sheet.toggle();
});

/** Шторка меняет высоту — сдвигаем камеру на половину прироста, чтобы
 *  содержимое ушло вверх, а не спряталось под панелью. Масштаб не трогаем:
 *  сбрасывать зум пользователю на каждое открытие панели — злодейство.
 *
 *  Высота едет по transition, поэтому мерить сразу после смены класса нельзя —
 *  getBoundingClientRect отдаст середину анимации. Ждём transitionend. */
let reframeFrom = null;

function withReframe(mutate) {
  const wide = window.innerWidth > 1000;
  const r0 = el.sheet.getBoundingClientRect();
  mutate();

  if (!wide) { reframeFrom = r0.top; return; }

  // На широком экране шторка — боковая панель, ширина меняется без анимации,
  // поэтому мерить можно сразу, а сдвигать надо по горизонтали.
  const d = r0.left - el.sheet.getBoundingClientRect().left;
  sc.setViewBand(viewInsets());
  if (Math.abs(d) < 2) return;
  const v = sc.getTopView();
  sc.setTopView(v.cx + (d / 2) / v.pxPerCm, v.cy);
}

el.sheet.addEventListener('transitionend', (e) => {
  if (e.target !== el.sheet || e.propertyName !== 'height' || reframeFrom === null) return;
  const d = reframeFrom - el.sheet.getBoundingClientRect().top;
  reframeFrom = null;
  sc.setViewBand(viewInsets());
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
  else if (ui.panel === 'import') node = UI.renderImportPanel(A);
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

const A = createRoomActions({
  state, ui, commit, toast, uid, renderZoomDependent, renderPanel, fitRoom, snap: SNAP,
});

Object.assign(A, createObjectActions({ state, ui, commit, uid, select, viewCenter }));

Object.assign(A, createShellActions({
  state, ui, store, history, storage, sc, uid, defaultScene, select, toast,
  commit, applyScene, renderScene, renderPanel, fitRoom, viewInsets,
  activeVariant, nextVariantName, updateUndoButtons,
  setVariantName: (n) => { el.variantName.textContent = n; },
}));

// ---- жесты -------------------------------------------------------------

const gestures = createGestures({
  sc, state, ui, A, toast, commit,
  renderScene, renderZoomDependent, zoomLimits, select, renderPanel,
});
gestures.attach(sc.renderer.domElement);

// ---- вид ---------------------------------------------------------------

function setView(mode) {
  const is3d = mode === '3d';
  sc.setMode(mode);
  // контур стен и ручки правки заданы в пикселях вида сверху — в 3D им нечего делать
  sc.groups.gOutline.visible = !is3d;
  sc.groups.gEdit.visible = !is3d;
  if (is3d && sc.needsFraming()) {
    sc.frame3d(G.polygonBounds(state.scene.room.vertices), state.scene.room.wallHeight);
  }
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

  const saved = storage.load();
  if (saved) {
    store.activeId = saved.activeId;
    store.variants = saved.variants;
    state.scene = activeVariant().scene;
  }
  history.ensure(store.activeId, state.scene);
  updateUndoButtons();
  el.variantName.textContent = state.scene.name;

  el.btnTop.addEventListener('click', () => setView('top'));
  el.btn3d.addEventListener('click', () => setView('3d'));
  el.btnRoom.addEventListener('click', () => showPanel(ui.panel === 'room' ? 'hint' : 'room'));
  el.btnAdd.addEventListener('click', () => showPanel(ui.panel === 'add' ? 'hint' : 'add'));
  el.btnUndo.addEventListener('click', () => A.undo());
  el.btnRedo.addEventListener('click', () => A.redo());
  el.btnVariants.addEventListener('click', () => UI.popover(el.btnVariants, UI.variantsMenu(store, A)));
  el.btnMore.addEventListener('click', () => UI.popover(el.btnMore, UI.menuList([
    { label: S.exportJson, onClick: () => A.exportScene() },
    { label: S.copyJson, onClick: () => A.copyJson() },
    { label: S.importJson, onClick: () => showPanel('import') },
    { sep: true },
    { label: S.screenshot, onClick: () => A.screenshot() },
    { sep: true },
    { label: S.reset, danger: true, confirm: true, onClick: () => A.resetAll() },
  ])));

  renderScene();
  // сначала шторка, потом вписывание: fitRoom считает свободную часть кадра
  withoutTransition(() => showPanel('hint'));
  sc.setViewBand(viewInsets());
  fitRoom();
}

boot();

// временный крючок для отладки
window.__cw = { sc, state, ui, A, commit, renderScene, fitRoom };
