// Построители геометрии: комната, контур стен, ручки правки, объекты,
// зоны обслуживания, размерные линии.
//
// Всё, что задано в пикселях (контуры, ручки), пересобирается при зуме —
// linewidth в WebGL не работает, поэтому «толстые линии» здесь узкие квады.

import * as THREE from 'three';
import { wx, wz, DEG } from './scene3d.js';

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

// ======================================================================
//  Объекты: боксы, зоны обслуживания, подсветка состояния, размерные линии
// ======================================================================

const OBJ = {
  bad:  0xd9433f,
  warn: 0xe08a2b,
  sel:  0x2f7de1,
};

const RED = new THREE.Color(OBJ.bad);

/** Цвет бокса с учётом состояния. Заливку «красным на 30 %» из ТЗ делаем
 *  тонировкой материала: плоский квад на полу в виде сверху не виден —
 *  его закрывает сам объект, который выше. */
function tinted(hex, flag) {
  const c = new THREE.Color(hex);
  if (flag === 'bad') c.lerp(RED, 0.35);
  return c;
}

const MAT2 = {
  badLine:  new THREE.MeshBasicMaterial({ color: OBJ.bad, side: THREE.DoubleSide }),
  warnLine: new THREE.MeshBasicMaterial({ color: OBJ.warn, side: THREE.DoubleSide }),
  selLine:  new THREE.MeshBasicMaterial({ color: OBJ.sel, side: THREE.DoubleSide }),
  ring:     new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
  knob:     new THREE.MeshBasicMaterial({ color: OBJ.sel, side: THREE.DoubleSide }),
  dim:      new THREE.MeshBasicMaterial({ color: 0x333b45, side: THREE.DoubleSide }),
};

/** Углы подошвы. Дубль geometry.obbCorners, но здесь без импорта математики:
 *  meshes.js рисует, geometry.js считает, и смешивать их незачем. */
function corners(o) {
  const t = (o.rot || 0) * DEG;
  const cs = Math.cos(t), sn = Math.sin(t);
  const hl = o.l / 2, hw = o.w / 2;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]
    .map(([lx, ly]) => [o.x + lx * cs - ly * sn, o.y + lx * sn + ly * cs]);
}

const loop = (c) => [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];

/** Прямоугольник вокруг начала координат в локальной системе объекта.
 *  Он симметричен, поэтому переворот оси Y тут ни на что не влияет. */
function quadLocal(halfL, halfW, material, y) {
  const c = [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]];
  const pos = [];
  for (const k of [0, 1, 2, 0, 2, 3]) pos.push(c[k][0], y, c[k][1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.Mesh(g, material);
}

/** Боксы, зоны обслуживания и подписи. От зума не зависит.
 *
 *  Каждый объект — своя THREE.Group в собственной системе координат, чтобы
 *  на драге двигать группу, а не пересобирать BoxGeometry каждый кадр. */
export function buildObjects(sc, scene, flags, labelFor) {
  sc.clear(sc.groups.gObjects);

  for (const o of scene.objects) {
    const grp = new THREE.Group();
    grp.userData.id = o.id;
    grp.position.set(wx(o.x), 0, wz(o.y));
    grp.rotation.y = (o.rot || 0) * DEG;

    if (o.clearance?.on && o.clearance.margin > 0) {
      const m = o.clearance.margin;
      const mat = new THREE.MeshBasicMaterial({
        color: o.color, side: THREE.DoubleSide,
        transparent: true, opacity: 0.16, depthWrite: false,
      });
      // 1 см над полом, иначе зона мерцает с ним в z-буфере
      grp.add(quadLocal(o.l / 2 + m, o.w / 2 + m, mat, 1));
    }

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(o.l, o.h, o.w),
      new THREE.MeshLambertMaterial({
        color: tinted(o.color, flags.get(o.id)), side: THREE.DoubleSide,
        transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1,
      }),
    );
    box.position.set(0, o.h / 2, 0);
    box.userData.box = true;
    grp.add(box);

    const node = labelFor?.(o);
    if (node) {
      const tag = new sc.CSS2DObject(node);
      tag.position.set(0, o.h + 12, 0);
      grp.add(tag);
    }

    sc.groups.gObjects.add(grp);
  }
  sc.requestRender();
}

/** Подвинуть уже построенный объект, не пересобирая геометрию.
 *  Заодно освежаем тонировку: на драге состояние меняется каждый кадр. */
export function moveObjectMesh(sc, o, flag) {
  const grp = sc.groups.gObjects.children.find((g) => g.userData.id === o.id);
  if (!grp) return false;
  grp.position.set(wx(o.x), 0, wz(o.y));
  grp.rotation.y = (o.rot || 0) * DEG;
  const box = grp.children.find((c) => c.userData.box);
  if (box) box.material.color.copy(tinted(o.color, flag));
  sc.requestRender();
  return true;
}

/** Где сидит ручка поворота — за коротким торцом объекта. */
export function rotateHandlePos(o, pxPerCm) {
  const t = (o.rot || 0) * DEG;
  const d = o.l / 2 + 34 / Math.max(pxPerCm, 1e-6);
  return [o.x + Math.cos(t) * d, o.y + Math.sin(t) * d];
}

/** Контуры состояния, выделение и ручка поворота. Задано в пикселях. */
export function buildObjectOverlay(sc, scene, { selectedId, flags, pxPerCm, mode = 'top' }) {
  sc.clear(sc.groups.gOverlay);
  // В 3D пиксельные толщины бессмысленны — там контуры задаются в сантиметрах,
  // а ручка поворота вообще не рисуется: крутить объект — дело вида сверху.
  const px = mode === '3d' ? (n) => n * 1.6 : (n) => n / Math.max(pxPerCm, 1e-6);

  for (const o of scene.objects) {
    const c = corners(o);
    const f = flags.get(o.id) || 'ok';

    if (f === 'bad') {
      sc.groups.gOverlay.add(ribbon(loop(c), px(3), MAT2.badLine, 1.7));
    } else if (f === 'warn') {
      sc.groups.gOverlay.add(ribbon(loop(c), px(3), MAT2.warnLine, 1.7));
    }

    if (o.id === selectedId) {
      sc.groups.gOverlay.add(ribbon(loop(c), px(2.5), MAT2.selLine, 1.9));
      if (mode === '3d') continue;

      const hp = rotateHandlePos(o, pxPerCm);
      const t = (o.rot || 0) * DEG;
      const edge = [o.x + Math.cos(t) * (o.l / 2), o.y + Math.sin(t) * (o.l / 2)];
      sc.groups.gOverlay.add(ribbon([[edge, hp]], px(2), MAT2.selLine, 1.9));
      sc.groups.gOverlay.add(disc(hp[0], hp[1], px(20), MAT2.ring, 2.1));
      sc.groups.gOverlay.add(disc(hp[0], hp[1], px(17), MAT2.knob, 2.2));
      sc.groups.gOverlay.add(disc(hp[0], hp[1], px(6),  MAT2.ring, 2.3));
    }
  }
  sc.requestRender();
}

/** Отрезок, нарезанный на пунктир. */
function dashes(p, q, dashCm, gapCm) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const ux = dx / len, uy = dy / len;
  const out = [];
  for (let t = 0; t < len; t += dashCm + gapCm) {
    const t1 = Math.min(len, t + dashCm);
    out.push([[p[0] + ux * t, p[1] + uy * t], [p[0] + ux * t1, p[1] + uy * t1]]);
  }
  return out;
}

/** Размерные линии до стен по четырём направлениям мира. Рисуются на драге. */
export function buildDimLines(sc, o, dists, pxPerCm, fmt, mode = 'top') {
  sc.clear(sc.groups.gDim);
  if (!o) { sc.requestRender(); return; }
  const px = mode === '3d' ? (n) => n * 1.8 : (n) => n / Math.max(pxPerCm, 1e-6);

  const c = corners(o);
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  const rays = [
    ['left',  [minX, o.y], [-1, 0]],
    ['right', [maxX, o.y], [1, 0]],
    ['front', [o.x, minY], [0, -1]],
    ['back',  [o.x, maxY], [0, 1]],
  ];

  for (const [key, from, dir] of rays) {
    const d = dists[key];
    if (d === null || d === undefined || d < 1) continue;
    const to = [from[0] + dir[0] * d, from[1] + dir[1] * d];
    sc.groups.gDim.add(ribbon(dashes(from, to, px(7), px(5)), px(1.6), MAT2.dim, 2.5));

    const div = document.createElement('div');
    div.className = 'lbl is-dist';
    div.textContent = fmt(d);
    const tag = new sc.CSS2DObject(div);
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    tag.position.set(wx(mid[0]), 2.5, wz(mid[1]));
    sc.groups.gDim.add(tag);
  }
  sc.requestRender();
}
