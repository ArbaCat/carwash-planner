// Three.js: рендерер, камеры, сетка, свет. Геометрию комнаты и объектов
// добавляют build*-функции ниже; вся математика — в geometry.js.
//
// Система координат. В данных комната лежит в плоскости XY: X вправо, Y вглубь
// (на экране вверх). В Three.js вверх — это Y, поэтому пол — плоскость XZ и
// worldX = roomX, worldZ = -roomY, worldY = высота.
// Поворот rot (градусы против часовой в комнате) кладётся прямо в mesh.rotation.y.

import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

  // Орбита. Демпфирование выключено намеренно: оно требует непрерывного
  // rAF, а рендерим мы по требованию, чтобы iPad не грелся от простоя.
  const controls = new OrbitControls(persp, renderer.domElement);
  controls.enableDamping = false;
  controls.enabled = false;
  controls.maxPolarAngle = Math.PI / 2 * 0.98;   // под пол не пускаем
  controls.minDistance = 150;
  controls.maxDistance = 20000;
  controls.addEventListener('change', () => requestRender());

  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  let size = { w: 1, h: 1 };
  let mode = 'top';           // 'top' | '3d'
  let framed3d = false;       // камеру 3D ставим только при первом входе
  let bandInsets = null;      // функция, отдающая отступы тулбара и шторки
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
    if (bandInsets) setViewBand(bandInsets());
    else { persp.aspect = size.w / size.h; persp.updateProjectionMatrix(); }
    applyTopFrustum();
    requestRender();
  }

  function setMode(m) {
    mode = m;
    controls.enabled = (m === '3d');
    requestRender();
  }

  // Свободная от тулбара и шторки полоса кадра. Перспективной камере она
  // задаётся через setViewOffset: камера строит фрустум для виртуального
  // холста, из которого мы рисуем реальный, — так центр кадра совпадает
  // с центром видимой полосы, и комната не уезжает под шторку.
  let band = null;

  function setViewBand(ins) {
    const W = size.w, H = size.h;
    const vw = Math.max(80, W - ins.left - ins.right);
    const vh = Math.max(80, H - ins.top - ins.bottom);
    const cx = ins.left + vw / 2, cy = ins.top + vh / 2;
    const fullW = 2 * Math.max(cx, W - cx);
    const fullH = 2 * Math.max(cy, H - cy);
    band = { fullW, fullH, offX: fullW / 2 - cx, offY: fullH / 2 - cy, vw, vh };
    persp.aspect = fullW / fullH;
    persp.setViewOffset(fullW, fullH, band.offX, band.offY, W, H);
    persp.updateProjectionMatrix();
    requestRender();
  }

  /** Тангенсы полуугла обзора видимой полосы — по ним считается дистанция. */
  function bandTangents() {
    const t = Math.tan(persp.fov * DEG / 2);
    if (!band) return { v: t, h: t * persp.aspect };
    return {
      v: t * (band.vh / band.fullH),
      h: t * persp.aspect * (band.vw / band.fullW),
    };
  }

  /** Поставить камеру 3D так, чтобы комната целиком влезла в кадр. */
  function frame3d(bounds, wallHeight) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const rw = Math.max(100, bounds.maxX - bounds.minX);
    const rd = Math.max(100, bounds.maxY - bounds.minY);
    const radius = Math.hypot(rw, rd, wallHeight) / 2;

    const tg = bandTangents();
    const dist = radius / Math.sin(Math.atan(Math.min(tg.v, tg.h))) * 1.06;

    controls.target.set(wx(cx), wallHeight * 0.35, wz(cy));
    // взгляд с угла: азимут 45°, подъём 32°
    const az = Math.PI / 4, el = 32 * DEG;
    persp.position.set(
      controls.target.x + Math.cos(el) * Math.cos(az) * dist,
      controls.target.y + Math.sin(el) * dist,
      controls.target.z + Math.cos(el) * Math.sin(az) * dist,
    );
    controls.update();
    framed3d = true;
    requestRender();
  }

  const needsFraming = () => !framed3d;

  /** Мировые матрицы считаются при рендере, а рендерим мы по требованию.
   *  Значит, тап сразу после пересборки сцены попал бы по старым матрицам —
   *  поэтому перед рейкастом обновляем их руками. Узлов десятки, это дёшево. */
  function syncMatrices(root) {
    persp.updateMatrixWorld();
    if (root) root.updateWorldMatrix(false, true);
  }

  /** Экран -> точка на полу комнаты через рейкаст. Нужно для драга в 3D. */
  function screenToFloor(px, py) {
    syncMatrices(null);
    const ndc = new THREE.Vector2((px / size.w) * 2 - 1, -(py / size.h) * 2 + 1);
    raycaster.setFromCamera(ndc, persp);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return null;
    return { x: hit.x, y: -hit.z };
  }

  /** Какой объект под точкой экрана в 3D. */
  function pickObject3d(px, py) {
    syncMatrices(gObjects);
    const ndc = new THREE.Vector2((px / size.w) * 2 - 1, -(py / size.h) * 2 + 1);
    raycaster.setFromCamera(ndc, persp);
    for (const hit of raycaster.intersectObjects(gObjects.children, true)) {
      let n = hit.object;
      while (n && !n.userData.id) n = n.parent;
      if (n?.userData.id) return n.userData.id;
    }
    return null;
  }
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
    controls, requestRender, drawNow, resize, setMode, getMode,
    frame3d, needsFraming, screenToFloor, pickObject3d, setViewBand,
    onInsets(fn) { bandInsets = fn; },
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
