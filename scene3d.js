// Three.js: рендерер, камеры, сетка, свет. Геометрию комнаты и объектов
// добавляют build*-функции ниже; вся математика — в geometry.js.
//
// Система координат. В данных комната лежит в плоскости XY: X вправо, Y вглубь
// (на экране вверх). В Three.js вверх — это Y, поэтому пол — плоскость XZ и
// worldX = roomX, worldZ = -roomY, worldY = высота.
// Поворот rot (градусы против часовой в комнате) кладётся прямо в mesh.rotation.y.

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const DEG = Math.PI / 180;

/** roomXY -> worldXZ */
export const wx = (x) => x;
export const wz = (y) => -y;

const BG = 0xeef1f4;
const GRID_MINOR = 0x000000, GRID_MAJOR = 0x000000;

export function createScene({ canvasHost, labelHost }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BG, 1);
  canvasHost.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.style.position = 'absolute';
  labels.domElement.style.top = '0';
  labels.domElement.style.left = '0';
  labels.domElement.style.pointerEvents = 'none';
  labelHost.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  // Интенсивности подобраны под современный three.js: свет считается в
  // физических единицах, диффуз делится на PI, поэтому «обычные» 1.0 дают
  // заметно тёмную картинку. Здесь пол выходит почти белым, но не в клиппинг.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8d99a6, 2.2);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.85);
  dir.position.set(400, 900, 500);
  scene.add(dir);

  // группы: пол/стены, сетка, объекты, оверлей (размерные линии), правка стен
  const gRoom    = new THREE.Group();
  const gGrid    = new THREE.Group();
  const gOutline = new THREE.Group();
  const gObjects = new THREE.Group();
  const gOverlay = new THREE.Group();
  const gEdit    = new THREE.Group();
  scene.add(gRoom, gGrid, gOutline, gObjects, gOverlay, gEdit);

  // ---- камеры ----------------------------------------------------------

  // Вид сверху: ортографическая, строго вниз. up = -Z, чтобы +Y комнаты
  // смотрел на экране вверх.
  const top = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);
  top.position.set(0, 5000, 0);
  top.up.set(0, 0, -1);
  top.lookAt(0, 0, 0);

  const persp = new THREE.PerspectiveCamera(50, 1, 10, 40000);
  persp.position.set(900, 800, 900);

  // состояние вида сверху в единицах комнаты
  const topView = { cx: 0, cy: 0, pxPerCm: 0.5 };

  let size = { w: 1, h: 1 };
  let mode = 'top';           // 'top' | '3d'
  let needsRender = false, rafId = 0;
  let lost = false;

  function requestRender() {
    if (needsRender || lost) return;
    needsRender = true;
    rafId = requestAnimationFrame(draw);
  }

  function draw() {
    needsRender = false; rafId = 0;
    if (lost) return;
    const cam = mode === 'top' ? top : persp;
    renderer.render(scene, cam);
    labels.render(scene, cam);
  }

  /** Отрисовать немедленно, синхронно (нужно перед toDataURL). */
  function drawNow() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; needsRender = false; }
    draw();
  }

  function applyTopFrustum() {
    const halfW = size.w / (2 * topView.pxPerCm);
    const halfH = size.h / (2 * topView.pxPerCm);
    top.left = -halfW; top.right = halfW;
    top.top = halfH;   top.bottom = -halfH;
    top.position.set(wx(topView.cx), 5000, wz(topView.cy));
    top.lookAt(wx(topView.cx), 0, wz(topView.cy));
    top.updateProjectionMatrix();
  }

  function resize(w, h) {
    size = { w: Math.max(1, w), h: Math.max(1, h) };
    renderer.setSize(size.w, size.h, false);
    labels.setSize(size.w, size.h);
    persp.aspect = size.w / size.h;
    persp.updateProjectionMatrix();
    applyTopFrustum();
    requestRender();
  }

  function setMode(m) { mode = m; requestRender(); }
  function getMode() { return mode; }

  function setTopView(cx, cy, pxPerCm) {
    topView.cx = cx; topView.cy = cy;
    if (pxPerCm) topView.pxPerCm = pxPerCm;
    applyTopFrustum();
    requestRender();
  }
  function getTopView() { return { ...topView }; }
  function getSize() { return { ...size }; }

  /** Экран (px относительно канваса) -> координаты комнаты. */
  function screenToRoom(px, py) {
    return {
      x: topView.cx + (px - size.w / 2) / topView.pxPerCm,
      y: topView.cy - (py - size.h / 2) / topView.pxPerCm,
    };
  }

  /** Координаты комнаты -> экран (px относительно канваса). */
  function roomToScreen(x, y) {
    return {
      x: size.w / 2 + (x - topView.cx) * topView.pxPerCm,
      y: size.h / 2 - (y - topView.cy) * topView.pxPerCm,
    };
  }

  // ---- сетка -----------------------------------------------------------

  function clear(group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const c = group.children[i];
      group.remove(c);
      disposeDeep(c);
    }
  }

  /** Сетка пола: 50 см тонкой, каждый метр — жирнее. */
  function buildGrid(minX, minY, maxX, maxY) {
    clear(gGrid);
    const pad = 100;
    const x0 = Math.floor((minX - pad) / 50) * 50, x1 = Math.ceil((maxX + pad) / 50) * 50;
    const y0 = Math.floor((minY - pad) / 50) * 50, y1 = Math.ceil((maxY + pad) / 50) * 50;

    const minor = [], major = [];
    for (let x = x0; x <= x1; x += 50) {
      const t = (x % 100 === 0) ? major : minor;
      t.push(wx(x), 0, wz(y0), wx(x), 0, wz(y1));
    }
    for (let y = y0; y <= y1; y += 50) {
      const t = (y % 100 === 0) ? major : minor;
      t.push(wx(x0), 0, wz(y), wx(x1), 0, wz(y));
    }
    gGrid.add(lines(minor, GRID_MINOR, 0.10));
    gGrid.add(lines(major, GRID_MAJOR, 0.22));
    gGrid.position.y = 0.4;   // чуть выше пола, чтобы не мерцало
    requestRender();
  }

  function lines(coords, color, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    return new THREE.LineSegments(g, m);
  }

  // ---- контекст WebGL --------------------------------------------------

  let onLost = null;
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    if (onLost) onLost();
  });

  return {
    THREE, renderer, labels, scene,
    groups: { gRoom, gGrid, gOutline, gObjects, gOverlay, gEdit },
    cameras: { top, persp },
    CSS2DObject,
    requestRender, drawNow, resize, setMode, getMode,
    setTopView, getTopView, getSize,
    screenToRoom, roomToScreen,
    buildGrid, clear, lines,
    onContextLost(fn) { onLost = fn; },
    isLost() { return lost; },
  };
}

/** Рекурсивно освободить геометрии и материалы. */
export function disposeDeep(obj) {
  obj.traverse?.((n) => {
    if (n.geometry) n.geometry.dispose();
    const m = n.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else if (m) m.dispose();
    if (n.element && n.element.remove) n.element.remove();  // CSS2DObject
  });
}

// ======================================================================
//  Комната: пол, стены, контур для вида сверху, ворота
// ======================================================================

const C = {
  floor:    0xf7f9fb,
  wall:     0xc4cdd8,
  gateWall: 0x86b4f0,
  outline:  0x2b333d,
  gateLine: 0x2f7de1,
  handle:   0x2f7de1,
  handleBad: 0xd9433f,
  add:      0x4b9d5e,
};

const MAT = {
  floor:    new THREE.MeshLambertMaterial({ color: C.floor }),
  // BackSide: стены, обращённые к камере лицом, не рисуются — интерьер видно
  // с любого ракурса, руками ничего скрывать не надо
  wall:     new THREE.MeshLambertMaterial({ color: C.wall, side: THREE.BackSide }),
  gateWall: new THREE.MeshLambertMaterial({ color: C.gateWall, side: THREE.BackSide }),
  outline:  new THREE.MeshBasicMaterial({ color: C.outline, side: THREE.DoubleSide }),
  gateLine: new THREE.MeshBasicMaterial({ color: C.gateLine, side: THREE.DoubleSide }),
  handle:   new THREE.MeshBasicMaterial({ color: C.handle, side: THREE.DoubleSide }),
  handleBad: new THREE.MeshBasicMaterial({ color: C.handleBad, side: THREE.DoubleSide }),
  handleRing: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  add:      new THREE.MeshBasicMaterial({ color: C.add, side: THREE.DoubleSide }),
};

/** Точка на ребре комнаты на расстоянии t см от его начала. */
function alongEdge(a, b, len, t) {
  const k = len < 1e-9 ? 0 : t / len;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Ребро, разбитое воротами на участки: {t0, t1, gate|null}. */
export function edgeSpans(room, i) {
  const v = room.vertices, n = v.length;
  const a = v[i], b = v[(i + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);

  const gates = (room.gates || [])
    .filter((g) => g.edgeIndex === i)
    .map((g) => ({ gate: g, t0: Math.max(0, g.offset), t1: Math.min(len, g.offset + g.width) }))
    .filter((g) => g.t1 - g.t0 > 0.5)
    .sort((p, q) => p.t0 - q.t0);

  const spans = [];
  let t = 0;
  for (const g of gates) {
    if (g.t0 > t + 0.5) spans.push({ t0: t, t1: g.t0, gate: null });
    spans.push({ t0: Math.max(t, g.t0), t1: g.t1, gate: g.gate });
    t = Math.max(t, g.t1);
  }
  if (t < len - 0.5) spans.push({ t0: t, t1: len, gate: null });
  return { a, b, len, spans };
}

/** Пол и стены. Ворота — участок стены в две трети высоты другим цветом:
 *  дырку в геометрии не вырезаем, для понимания объёма этого достаточно. */
export function buildRoom(sc, room) {
  sc.clear(sc.groups.gRoom);
  const poly = room.vertices;
  if (!poly || poly.length < 3) { sc.requestRender(); return; }

  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), MAT.floor);
  floor.rotation.x = -Math.PI / 2;     // (u,v,0) -> (u,0,-v)
  floor.name = 'floor';
  sc.groups.gRoom.add(floor);

  const h = room.wallHeight || 300;
  for (let i = 0; i < poly.length; i++) {
    const { a, b, len, spans } = edgeSpans(room, i);
    if (len < 1) continue;
    // внешняя нормаль ребра (полигон против часовой) в мировых осях
    const rotY = Math.atan2((b[1] - a[1]) / len, (b[0] - a[0]) / len);

    for (const s of spans) {
      const segLen = s.t1 - s.t0;
      if (segLen < 0.5) continue;
      const hh = s.gate ? h * (2 / 3) : h;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(segLen, hh),
        s.gate ? MAT.gateWall : MAT.wall,
      );
      const mid = alongEdge(a, b, len, (s.t0 + s.t1) / 2);
      mesh.position.set(wx(mid[0]), hh / 2, wz(mid[1]));
      mesh.rotation.y = rotY;
      sc.groups.gRoom.add(mesh);
    }
  }
  sc.requestRender();
}

/** Полоса заданной ширины по отрезкам, лежащая в плоскости пола.
 *  linewidth в WebGL не работает, поэтому «толстые линии» — это узкие квады. */
export function ribbon(segs, widthCm, material, y = 1) {
  const pos = [];
  const hw = widthCm / 2;
  for (const [p, q] of segs) {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * hw, ny = (dx / len) * hw;
    // четыре угла полосы, два треугольника
    const c = [
      [p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny],
      [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) pos.push(wx(c[k][0]), y, wz(c[k][1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

/** Контур стен для вида сверху. Толщина задана в пикселях, поэтому геометрию
 *  пересобираем при зуме — иначе на приближении контур разъезжается в плиту. */
export function buildWallOutline(sc, room, pxPerCm) {
  sc.clear(sc.groups.gOutline);
  const poly = room.vertices;
  if (!poly || poly.length < 3) { sc.requestRender(); return; }

  const px = (n) => n / Math.max(pxPerCm, 1e-6);
  const wallW = px(3), gateW = px(2);

  const wallSegs = [], gateSegs = [], tickSegs = [];
  for (let i = 0; i < poly.length; i++) {
    const { a, b, len, spans } = edgeSpans(room, i);
    if (len < 1) continue;
    const inx = -(b[1] - a[1]) / len, iny = (b[0] - a[0]) / len;  // внутрь комнаты

    for (const s of spans) {
      const p = alongEdge(a, b, len, s.t0), q = alongEdge(a, b, len, s.t1);
      if (!s.gate) { wallSegs.push([p, q]); continue; }
      // проём: линия отступает внутрь и штрихи по краям
      const off = px(4);
      gateSegs.push([[p[0] + inx * off, p[1] + iny * off],
                     [q[0] + inx * off, q[1] + iny * off]]);
      for (const e of [p, q]) {
        tickSegs.push([e, [e[0] + inx * px(11), e[1] + iny * px(11)]]);
      }
    }
  }

  if (wallSegs.length) sc.groups.gOutline.add(ribbon(wallSegs, wallW, MAT.outline, 1.2));
  if (gateSegs.length) sc.groups.gOutline.add(ribbon(gateSegs, gateW, MAT.gateLine, 1.2));
  if (tickSegs.length) sc.groups.gOutline.add(ribbon(tickSegs, gateW, MAT.gateLine, 1.2));
  sc.requestRender();
}

/** Круг в плоскости пола. */
export function disc(cx, cy, rCm, material, y = 2, segs = 28) {
  const pos = [];
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    pos.push(wx(cx), y, wz(cy));
    pos.push(wx(cx + Math.cos(a0) * rCm), y, wz(cy + Math.sin(a0) * rCm));
    pos.push(wx(cx + Math.cos(a1) * rCm), y, wz(cy + Math.sin(a1) * rCm));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, material);
}

/** Ручки правки стен: круги на вершинах и плюсы на серединах рёбер.
 *  Размеры заданы в пикселях, поэтому пересобираются при зуме. */
export function buildEditHandles(sc, room, pxPerCm, { badIndex = -1 } = {}) {
  sc.clear(sc.groups.gEdit);
  const poly = room.vertices;
  if (!poly || poly.length < 3) { sc.requestRender(); return; }

  const px = (n) => n / Math.max(pxPerCm, 1e-6);

  // плюсы на серединах рёбер — под вершинами по z-порядку
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < px(56)) continue;                 // на короткой стене плюс не влезает
    const m = alongEdge(a, b, len, len / 2);
    sc.groups.gEdit.add(disc(m[0], m[1], px(15), MAT.handleRing, 2.4));
    sc.groups.gEdit.add(disc(m[0], m[1], px(13), MAT.add, 2.6));
    const bar = px(8), th = px(2.5);
    sc.groups.gEdit.add(ribbon([[[m[0] - bar, m[1]], [m[0] + bar, m[1]]]], th, MAT.handleRing, 2.8));
    sc.groups.gEdit.add(ribbon([[[m[0], m[1] - bar], [m[0], m[1] + bar]]], th, MAT.handleRing, 2.8));
  }

  // вершины
  poly.forEach(([x, y], i) => {
    sc.groups.gEdit.add(disc(x, y, px(20), MAT.handleRing, 3.0));
    sc.groups.gEdit.add(disc(x, y, px(17), i === badIndex ? MAT.handleBad : MAT.handle, 3.2));
  });

  sc.requestRender();
}
