import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../geometry.js';

// Комната из ТЗ: 1200x600 с выступом — вырезан угол x>900, y>400.
const L_ROOM = [[0, 0], [1200, 0], [1200, 400], [900, 400], [900, 600], [0, 600]];
const RECT = [[0, 0], [1000, 0], [1000, 600], [0, 600]];

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `ожидалось ${b}, получено ${a}`);

// ---------------------------------------------------------------- snap

test('snap: округление к сетке', () => {
  assert.equal(G.snap(23, 10), 20);
  assert.equal(G.snap(25, 10), 30);
  assert.equal(G.snap(-23, 10), -20);
  assert.equal(G.snap(-25, 10), -20);   // половина вверх, как Math.round
  assert.equal(G.snap(1234, 50), 1250);
  assert.equal(G.snap(7, 1), 7);
});

// ------------------------------------------------------- polygonArea

test('polygonArea: знак выдаёт ориентацию', () => {
  // прямоугольник против часовой — площадь положительная
  near(G.polygonArea(RECT), 1000 * 600);
  // тот же по часовой — отрицательная
  near(G.polygonArea([...RECT].reverse()), -1000 * 600);
});

test('polygonArea: Г-образная комната с выступом', () => {
  // 1200*600 минус вырезанные 300*200
  near(G.polygonArea(L_ROOM), 1200 * 600 - 300 * 200);
  assert.ok(G.polygonArea(L_ROOM) > 0, 'вершины из ТЗ идут против часовой');
});

// ----------------------------------------------------- pointInPolygon

test('pointInPolygon: точка на ребре считается внутри', () => {
  assert.equal(G.pointInPolygon([500, 0], RECT), true, 'середина нижнего ребра');
  assert.equal(G.pointInPolygon([0, 300], RECT), true, 'середина левого ребра');
  assert.equal(G.pointInPolygon([0, 0], RECT), true, 'вершина');
  assert.equal(G.pointInPolygon([1000, 600], RECT), true, 'дальняя вершина');
});

test('pointInPolygon: внутри и снаружи прямоугольника', () => {
  assert.equal(G.pointInPolygon([500, 300], RECT), true);
  assert.equal(G.pointInPolygon([-1, 300], RECT), false);
  assert.equal(G.pointInPolygon([1001, 300], RECT), false);
  assert.equal(G.pointInPolygon([500, 601], RECT), false);
});

test('pointInPolygon: вырезанный угол Г-образной комнаты снаружи', () => {
  assert.equal(G.pointInPolygon([950, 300], L_ROOM), true,  'под выступом — внутри');
  assert.equal(G.pointInPolygon([950, 500], L_ROOM), false, 'в вырезе — снаружи');
  assert.equal(G.pointInPolygon([500, 500], L_ROOM), true,  'в широкой части — внутри');
  assert.equal(G.pointInPolygon([900, 500], L_ROOM), true,  'на стене выреза — внутри');
  assert.equal(G.pointInPolygon([950, 400], L_ROOM), true,  'на потолке выреза — внутри');
});

// -------------------------------------------------- segmentsIntersect

test('segmentsIntersect: пересечение строгое, касание не считается', () => {
  assert.equal(G.segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0]), true, 'крест');
  assert.equal(G.segmentsIntersect([0, 0], [10, 0], [10, 0], [20, 0]), false, 'встык');
  assert.equal(G.segmentsIntersect([0, 0], [10, 0], [5, 0], [15, 0]), false, 'коллинеарные с наложением');
  assert.equal(G.segmentsIntersect([0, 0], [10, 0], [0, 5], [10, 5]), false, 'параллельные');
  assert.equal(G.segmentsIntersect([0, 0], [10, 10], [5, 5], [15, 0]), false, 'конец на середине другого');
});

// ---------------------------------------------------- polygonIsSimple

test('polygonIsSimple: комната с выступом — простая', () => {
  assert.equal(G.polygonIsSimple(L_ROOM), true);
  assert.equal(G.polygonIsSimple(RECT), true);
});

test('polygonIsSimple: самопересекающийся полигон отвергается', () => {
  const bowtie = [[0, 0], [100, 100], [100, 0], [0, 100]];
  assert.equal(G.polygonIsSimple(bowtie), false);
});

test('polygonIsSimple: меньше трёх вершин — не полигон', () => {
  assert.equal(G.polygonIsSimple([[0, 0], [10, 10]]), false);
  assert.equal(G.polygonIsSimple([]), false);
});

// --------------------------------------------------------- obbCorners

test('obbCorners: без поворота — оси комнаты', () => {
  const c = G.obbCorners({ x: 100, y: 50, l: 40, w: 20, rot: 0 });
  assert.equal(c.length, 4);
  const xs = c.map((p) => p[0]).sort((a, b) => a - b);
  const ys = c.map((p) => p[1]).sort((a, b) => a - b);
  near(xs[0], 80); near(xs[3], 120);   // длина вдоль X
  near(ys[0], 40); near(ys[3], 60);    // ширина вдоль Y
});

test('obbCorners: поворот на 90° меняет длину и ширину местами', () => {
  const c = G.obbCorners({ x: 100, y: 50, l: 40, w: 20, rot: 90 });
  const xs = c.map((p) => p[0]).sort((a, b) => a - b);
  const ys = c.map((p) => p[1]).sort((a, b) => a - b);
  near(xs[0], 90);  near(xs[3], 110);  // теперь по X — ширина 20
  near(ys[0], 30);  near(ys[3], 70);   // по Y — длина 40
});

test('obbCorners: поворот против часовой', () => {
  // объект без ширины: точка (+l/2, 0) при 90° уходит в +Y
  const c = G.obbCorners({ x: 0, y: 0, l: 200, w: 0, rot: 90 });
  const maxY = Math.max(...c.map((p) => p[1]));
  near(maxY, 100);
});

// --------------------------------------------------------- obbOverlap

test('obbOverlap: касание двух объектов — не пересечение', () => {
  const a = { x: 0,   y: 0, l: 100, w: 100, rot: 0 };
  const b = { x: 100, y: 0, l: 100, w: 100, rot: 0 };   // ровно встык по x=50
  assert.equal(G.obbOverlap(a, b), false);
});

test('obbOverlap: наезд на 1 см — пересечение', () => {
  const a = { x: 0,  y: 0, l: 100, w: 100, rot: 0 };
  const b = { x: 99, y: 0, l: 100, w: 100, rot: 0 };
  assert.equal(G.obbOverlap(a, b), true);
});

test('obbOverlap: далеко друг от друга', () => {
  const a = { x: 0,   y: 0, l: 100, w: 100, rot: 0 };
  const b = { x: 500, y: 0, l: 100, w: 100, rot: 0 };
  assert.equal(G.obbOverlap(a, b), false);
});

test('obbOverlap: повёрнутые прямоугольники — SAT, а не AABB', () => {
  // две параллельные диагональные полосы, разнесённые поперёк:
  // габаритные коробки перекрываются, сами полосы — нет
  const a = { x: 0,   y: 0,    l: 400, w: 20, rot: 45 };
  const b = { x: 100, y: -100, l: 400, w: 20, rot: 45 };

  const box = (o) => {
    const c = G.obbCorners(o);
    return {
      x0: Math.min(...c.map((p) => p[0])), x1: Math.max(...c.map((p) => p[0])),
      y0: Math.min(...c.map((p) => p[1])), y1: Math.max(...c.map((p) => p[1])),
    };
  };
  const ba = box(a), bb = box(b);
  assert.ok(ba.x1 > bb.x0 && bb.x1 > ba.x0 && ba.y1 > bb.y0 && bb.y1 > ba.y0,
    'габаритные коробки обязаны перекрываться, иначе тест ничего не проверяет');

  assert.equal(G.obbOverlap(a, b), false);
});

test('obbOverlap: повёрнутые крест-накрест — пересечение', () => {
  const c = { x: 0, y: 0, l: 400, w: 20, rot: 45 };
  const d = { x: 0, y: 0, l: 400, w: 20, rot: -45 };
  assert.equal(G.obbOverlap(c, d), true);
});

test('obbOverlap: один внутри другого', () => {
  const big   = { x: 0, y: 0, l: 400, w: 400, rot: 0 };
  const small = { x: 0, y: 0, l: 50,  w: 50,  rot: 30 };
  assert.equal(G.obbOverlap(big, small), true);
});

// -------------------------------------------------- footprintInsideRoom

test('footprintInsideRoom: объект ровно в углу — внутри', () => {
  const obj = { x: 100, y: 50, l: 200, w: 100, rot: 0 };  // x 0..200, y 0..100
  assert.equal(G.footprintInsideRoom(obj, RECT), true);
});

test('footprintInsideRoom: объект целиком внутри', () => {
  assert.equal(G.footprintInsideRoom({ x: 500, y: 300, l: 460, w: 180, rot: 0 }, RECT), true);
});

test('footprintInsideRoom: объект, повёрнутый на 30°, у стены', () => {
  // полуразмах по X = (400*cos30 + 200*sin30)/2 ≈ 223.2
  assert.equal(G.footprintInsideRoom({ x: 300, y: 300, l: 400, w: 200, rot: 30 }, RECT), true,
    'на 300 см от левой стены влезает');
  assert.equal(G.footprintInsideRoom({ x: 200, y: 300, l: 400, w: 200, rot: 30 }, RECT), false,
    'на 200 см — угол вылезает за стену');
});

test('footprintInsideRoom: объект в вырезе Г-образной комнаты — снаружи', () => {
  assert.equal(G.footprintInsideRoom({ x: 1050, y: 500, l: 200, w: 100, rot: 0 }, L_ROOM), false);
});

test('footprintInsideRoom: объект под выступом — внутри', () => {
  assert.equal(G.footprintInsideRoom({ x: 1000, y: 200, l: 300, w: 150, rot: 0 }, L_ROOM), true);
});

test('footprintInsideRoom: все углы внутри, но ребро выходит за выступ', () => {
  // ромб с центром в реуглу (900,400): все четыре угла на стенах или внутри,
  // но середина объекта накрывает вырез.
  const diamond = { x: 900, y: 400, l: 141.4213562, w: 141.4213562, rot: 45 };
  for (const c of G.obbCorners(diamond)) {
    assert.equal(G.pointInPolygon(c, L_ROOM), true, `угол ${c} должен быть внутри`);
  }
  assert.equal(G.footprintInsideRoom(diamond, L_ROOM), false,
    'проверка по одним углам такой случай пропускает');
});

// ----------------------------------------------------- distanceToWalls

test('distanceToWalls: объект в центре прямоугольника', () => {
  const d = G.distanceToWalls({ x: 500, y: 300, l: 200, w: 100, rot: 0 }, RECT);
  near(d.left,  400);   // -X: от x=400 до x=0
  near(d.right, 400);   // +X: от x=600 до x=1000
  near(d.front, 250);   // -Y: от y=250 до y=0
  near(d.back,  250);   // +Y: от y=350 до y=600
});

test('distanceToWalls: объект в углу — нули, а не null', () => {
  const d = G.distanceToWalls({ x: 100, y: 50, l: 200, w: 100, rot: 0 }, RECT);
  near(d.left,  0);
  near(d.front, 0);
  near(d.right, 800);
  near(d.back,  500);
});

test('distanceToWalls: луч через выступ находит ближнюю стену, а не дальнюю', () => {
  // объект под выступом: сверху 50 см до потолка выреза (y=400),
  // а не 250 см до дальней стены (y=600)
  const d = G.distanceToWalls({ x: 950, y: 300, l: 100, w: 100, rot: 0 }, L_ROOM);
  near(d.back,  50);
  near(d.front, 250);
  near(d.right, 200);
  near(d.left,  900);
});

test('distanceToWalls: повёрнутый объект мерит от габарита', () => {
  // при 45° полуразмах = (200+200)*cos45/2 ≈ 141.42
  const d = G.distanceToWalls({ x: 500, y: 300, l: 200, w: 200, rot: 45 }, RECT);
  near(d.left, 500 - 100 * Math.SQRT2, 1e-6);
});

test('distanceToWalls: снаружи комнаты и мимо стен — null', () => {
  const d = G.distanceToWalls({ x: 2000, y: 300, l: 100, w: 100, rot: 0 }, RECT);
  assert.equal(d.right, null, 'вправо от комнаты стен нет');
});

// --------------------------------------------------------- expandObb

test('expandObb: зона обслуживания растёт на отступ с каждой стороны', () => {
  const obj = { x: 300, y: 250, l: 460, w: 180, rot: 90, name: 'Octavia' };
  const z = G.expandObb(obj, 80);
  assert.equal(z.l, 460 + 160);
  assert.equal(z.w, 180 + 160);
  assert.equal(z.x, 300);
  assert.equal(z.y, 250);
  assert.equal(z.rot, 90);
  assert.equal(obj.l, 460, 'исходный объект не должен меняться');
});

test('expandObb: нулевой отступ ничего не меняет', () => {
  const z = G.expandObb({ x: 0, y: 0, l: 100, w: 50, rot: 0 }, 0);
  assert.equal(z.l, 100);
  assert.equal(z.w, 50);
});

// -------------------------------------------------------- nearestEdge

test('nearestEdge: находит стену под тапом и место на ней', () => {
  const r = G.nearestEdge([500, 30], RECT);
  assert.equal(r.index, 0, 'ребро (0,0)-(1000,0)');
  near(r.dist, 30);
  near(r.t, 500);
});

test('nearestEdge: выступ ближе дальней стены', () => {
  // точка под потолком выреза: ближайшее — ребро y=400, а не y=600
  const r = G.nearestEdge([1000, 380], L_ROOM);
  assert.equal(r.index, 2, 'ребро (1200,400)-(900,400)');
  near(r.dist, 20);
});

test('nearestEdge: за концом ребра мерит до вершины', () => {
  const r = G.nearestEdge([-40, -30], RECT);
  near(r.dist, 50);          // до угла (0,0)
  near(r.t, 0);
});

// --------------------------------------------------------- pointInObb

test('pointInObb: точка внутри и снаружи подошвы', () => {
  const o = { x: 100, y: 50, l: 200, w: 100, rot: 0 };
  assert.equal(G.pointInObb([100, 50], o), true,  'центр');
  assert.equal(G.pointInObb([199, 99], o), true,  'у угла изнутри');
  assert.equal(G.pointInObb([201, 50], o), false, 'сразу за бортом');
  assert.equal(G.pointInObb([100, 101], o), false);
});

test('pointInObb: граница считается попаданием', () => {
  const o = { x: 0, y: 0, l: 100, w: 100, rot: 0 };
  assert.equal(G.pointInObb([50, 0], o), true);
  assert.equal(G.pointInObb([50, 50], o), true, 'угол');
});

test('pointInObb: учитывает поворот, а не габаритную коробку', () => {
  const o = { x: 0, y: 0, l: 400, w: 20, rot: 45 };
  assert.equal(G.pointInObb([100, 100], o), true,  'на диагонали — внутри полосы');
  assert.equal(G.pointInObb([100, -100], o), false, 'в углу габаритной коробки — снаружи');
});

test('pointInObb: припуск расширяет попадание для мелких объектов', () => {
  const o = { x: 0, y: 0, l: 60, w: 60, rot: 0 };
  assert.equal(G.pointInObb([45, 0], o), false, 'без припуска мимо');
  assert.equal(G.pointInObb([45, 0], o, 20), true, 'с припуском 20 см — попадание');
});
