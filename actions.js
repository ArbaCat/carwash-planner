// Действия: комната, ворота, варианты, история, экспорт и импорт.
// Модуль не знает про DOM и Three.js — он меняет данные и просит перерисовать.
// Всё нужное приходит в ctx из app.js.

import * as G from './geometry.js';
import { S } from './strings.js';
import * as IO from './io.js';

/** Комната и ворота. */
export function createRoomActions(ctx) {
  const { state, ui, commit, toast, uid, renderZoomDependent, renderPanel, fitRoom, snap: SNAP } = ctx;
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
  return A;
}

/** Варианты, история, экспорт и импорт. */
export function createShellActions(ctx) {
  const {
    state, ui, store, history, storage, sc, uid, defaultScene, select, toast,
    commit, applyScene, renderScene, renderPanel, fitRoom, viewInsets,
    activeVariant, nextVariantName, setVariantName, updateUndoButtons,
  } = ctx;
  const A = {
  undo() { const s = history.undo(store.activeId); if (s) applyScene(s); },
  redo() { const s = history.redo(store.activeId); if (s) applyScene(s); },

  switchVariant(id) {
    if (!store.variants.some((v) => v.id === id)) return;
    store.activeId = id;
    state.scene = activeVariant().scene;
    history.ensure(id, state.scene);
    select(null);
    ui.wallEdit = false; ui.gatePick = false; ui.badVertex = -1;
    setVariantName(state.scene.name);
    storage.save(store);
    updateUndoButtons();
    renderScene();
    renderPanel();
    fitRoom();
  },

  newVariant() {
    const scene = defaultScene();
    scene.name = nextVariantName();
    const id = uid('v');
    store.variants = [...store.variants, { id, scene }];
    history.reset(id, scene);
    A.switchVariant(id);
  },

  duplicateVariant() {
    const scene = JSON.parse(JSON.stringify(state.scene));
    scene.name = `${state.scene.name} (${S.copySuffix})`;
    const id = uid('v');
    store.variants = [...store.variants, { id, scene }];
    history.reset(id, scene);
    A.switchVariant(id);
  },

  renameVariant(id, name) {
    const v = store.variants.find((x) => x.id === id);
    if (!v) return;
    const next = (name || '').trim();
    if (next) v.scene.name = next;
    if (id === store.activeId) setVariantName(v.scene.name);
    storage.save(store);
    renderPanel();
  },

  deleteVariant() {
    if (store.variants.length <= 1) return;
    const gone = store.activeId;
    store.variants = store.variants.filter((v) => v.id !== gone);
    history.drop(gone);
    A.switchVariant(store.variants[0].id);
  },

  getStore() { return store; },

  async exportScene() {
    const r = await IO.exportScene(state.scene);
    if (r === 'shared') toast(S.okShared);
    else if (r === 'downloaded') toast(S.okSaved);
  },

  async copyJson() {
    const ok = await IO.copyJson(state.scene);
    toast(ok ? S.okCopied : S.errCopy, ok ? '' : 'warn');
  },

  async screenshot() {
    const r = await IO.exportShot(sc, state.scene, viewInsets());
    if (r === 'shared') toast(S.okShared);
    else if (r === 'downloaded') toast(S.okSaved);
  },

  /** Импорт создаёт новый вариант и не трогает текущий. */
  importText(text) {
    const r = IO.parseScene(text);
    if (!r.ok) {
      toast(r.error === 'version' ? S.errImportVersion(r.version) : S.errImportShape, 'err');
      return false;
    }
    const id = uid('v');
    store.variants = [...store.variants, { id, scene: r.scene }];
    history.reset(id, r.scene);
    A.switchVariant(id);
    toast(S.okImported);
    return true;
  },

  resetAll() {
    storage.clear();
    const scene = defaultScene();
    const id = uid('v');
    store.variants = [{ id, scene }];
    history.reset(id, scene);
    A.switchVariant(id);
  },
  };
  return A;
}
