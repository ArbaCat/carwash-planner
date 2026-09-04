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
  const gDim     = new THREE.Group();
  const gEdit    = new THREE.Group();
  scene.add(gRoom, gGrid, gOutline, gObjects, gOverlay, gDim, gEdit);

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
    groups: { gRoom, gGrid, gOutline, gObjects, gOverlay, gDim, gEdit },
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
