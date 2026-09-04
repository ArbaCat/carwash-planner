// Чистая математика планировщика. Ни DOM, ни Three.js — только числа и массивы.
// Единицы — сантиметры. Точка — [x, y], полигон — массив точек, объект —
// { x, y, l, w, rot }: центр подошвы, длина вдоль локальной оси, ширина
// поперёк, поворот в градусах против часовой.
//
// Это единственный файл, покрытый тестами: node --test tests/

const DEG = Math.PI / 180;

/** Допуск в сантиметрах. Всё мельче — шум плавающей точки, а не геометрия. */
const EPS = 1e-6;

/** Округление к сетке. */
export function snap(v, step) {
  if (!step) return v;
  return Math.round(v / step) * step;
}

/** Знаковая площадь по формуле шнурков. Знак выдаёт ориентацию:
 *  больше нуля — против часовой. */
export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Векторное произведение (q−p)×(r−p), нормированное на длину pq.
 *  По сути — расстояние от r до прямой pq со знаком, в сантиметрах. */
function sideDist(p, q, r) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  if (len < EPS) return 0;
  return (dx * (r[1] - p[1]) - dy * (r[0] - p[0])) / len;
}

/** Точка лежит на отрезке (с допуском, включая концы). */
function pointOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS * EPS) return Math.hypot(p[0] - a[0], p[1] - a[1]) <= EPS;
  if (Math.abs(sideDist(a, b, p)) > EPS) return false;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  return t >= -EPS && t <= 1 + EPS;
}

/** Отрезки пересекаются строго: касание концами и наложение коллинеарных
 *  за пересечение не считаются. */
export function segmentsIntersect(a, b, c, d) {
  const d1 = sideDist(c, d, a), d2 = sideDist(c, d, b);
  const d3 = sideDist(a, b, c), d4 = sideDist(a, b, d);
  const straddle = (u, v) => (u > EPS && v < -EPS) || (u < -EPS && v > EPS);
  return straddle(d1, d2) && straddle(d3, d4);
}

/** Точка внутри полигона: луч чёт-нечет. Точка на ребре — внутри. */
export function pointInPolygon(p, poly) {
  const n = poly.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    if (pointOnSegment(p, poly[i], poly[(i + 1) % n])) return true;
  }

  const [px, py] = p;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py)) {
      const xCross = xi + ((py - yi) * (xj - xi)) / (yj - yi);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

/** Полигон без самопересечений и без нулевых рёбер, минимум три вершины. */
export function polygonIsSimple(poly) {
  const n = poly.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPS) return false;
  }

  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = poly[j], d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return false;

      const adjacent = (j === i + 1) || (i === 0 && j === n - 1);
      if (adjacent) {
        // смежные рёбра всегда делят вершину — ловим только загиб назад,
        // когда дальний конец соседнего ребра лёг на это ребро
        const far = (j === i + 1) ? d : c;
        if (pointOnSegment(far, a, b)) return false;
      } else if (
        pointOnSegment(c, a, b) || pointOnSegment(d, a, b) ||
        pointOnSegment(a, c, d) || pointOnSegment(b, c, d)
      ) {
        return false;
      }
    }
  }
  return true;
}

/** Оси объекта: вдоль длины и поперёк. */
function obbAxes(o) {
  const t = (o.rot || 0) * DEG;
  const cs = Math.cos(t), sn = Math.sin(t);
  return [[cs, sn], [-sn, cs]];
}

/** Четыре угла подошвы, против часовой начиная с «левого нижнего» локального. */
export function obbCorners(obj) {
  const { x, y, l, w } = obj;
  const [ax, ay] = obbAxes(obj);
  const hl = l / 2, hw = w / 2;
  return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([lx, ly]) => [
    x + lx * ax[0] + ly * ay[0],
    y + lx * ax[1] + ly * ay[1],
  ]);
}

function project(pts, ax) {
  let mn = Infinity, mx = -Infinity;
  for (const p of pts) {
    const d = p[0] * ax[0] + p[1] * ax[1];
    if (d < mn) mn = d;
    if (d > mx) mx = d;
  }
  return [mn, mx];
}

/** Пересечение двух повёрнутых прямоугольников — SAT по четырём осям.
 *  Касание пересечением не считается. */
export function obbOverlap(a, b) {
  const ca = obbCorners(a), cb = obbCorners(b);
  for (const ax of [...obbAxes(a), ...obbAxes(b)]) {
    const [amin, amax] = project(ca, ax);
    const [bmin, bmax] = project(cb, ax);
    if (amax <= bmin + EPS || bmax <= amin + EPS) return false;
  }
  return true;
}

/** Точка строго внутри подошвы объекта (без границы). */
function pointInObbStrict(p, obj) {
  const [ax, ay] = obbAxes(obj);
  const dx = p[0] - obj.x, dy = p[1] - obj.y;
  const lx = dx * ax[0] + dy * ax[1];
  const ly = dx * ay[0] + dy * ay[1];
  return Math.abs(lx) < obj.l / 2 - EPS && Math.abs(ly) < obj.w / 2 - EPS;
}

/** Подошва целиком внутри комнаты.
 *  Одних углов не хватает: у комнаты с выступом бывает, что все четыре угла
 *  внутри, а середина объекта накрывает вырез. Поэтому ещё две проверки —
 *  рёбра подошвы не пересекают стены, и ни одна вершина комнаты не лежит
 *  внутри подошвы. */
export function footprintInsideRoom(obj, poly) {
  const n = poly.length;
  if (n < 3) return false;

  const c = obbCorners(obj);
  for (const p of c) if (!pointInPolygon(p, poly)) return false;

  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    for (let j = 0; j < n; j++) {
      if (segmentsIntersect(a, b, poly[j], poly[(j + 1) % n])) return false;
    }
  }

  for (const v of poly) if (pointInObbStrict(v, obj)) return false;

  return true;
}

/** Параметр t, на котором луч o+t*d впервые встречает отрезок ab; null — мимо. */
function raySegment(o, d, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-12) return null;          // параллельно
  const rx = a[0] - o[0], ry = a[1] - o[1];
  const t = (rx * ey - ry * ex) / den;             // вдоль луча
  const u = (rx * d[1] - ry * d[0]) / den;         // вдоль отрезка
  if (t < -EPS || u < -EPS || u > 1 + EPS) return null;
  return Math.max(t, 0);
}

function rayToWall(o, d, poly) {
  let best = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const t = raySegment(o, d, poly[i], poly[(i + 1) % n]);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Расстояния от габарита подошвы до первой стены по четырём направлениям мира:
 *  left = −X, right = +X, front = −Y, back = +Y. null — стены на этом луче нет.
 *
 *  Луч выходит из крайней точки подошвы по измеряемой оси, а по другой оси стоит на
 *  центре объекта — так размерная линия выходит из середины борта, а не из
 *  случайного угла. Луч берёт первую стену, поэтому в комнате с выступом
 *  показывается выступ, а не дальняя стена за ним. */
export function distanceToWalls(obj, poly) {
  const c = obbCorners(obj);
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  return {
    left:  rayToWall([Math.min(...xs), obj.y], [-1, 0], poly),
    right: rayToWall([Math.max(...xs), obj.y], [1, 0], poly),
    front: rayToWall([obj.x, Math.min(...ys)], [0, -1], poly),
    back:  rayToWall([obj.x, Math.max(...ys)], [0, 1], poly),
  };
}

/** Зона обслуживания: тот же объект, раздутый на отступ с каждой стороны. */
export function expandObb(obj, margin) {
  return { ...obj, l: obj.l + 2 * margin, w: obj.w + 2 * margin };
}

// ---- вспомогательное для приложения (тоже чистое) ----

/** Габаритная коробка полигона. */
export function polygonBounds(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys),
           maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Ближайшее ребро полигона к точке: индекс, положение вдоль ребра в см,
 *  расстояние и сама проекция. При равном расстоянии выигрывает ребро
 *  с меньшим индексом. Нужно, чтобы поставить ворота тапом по стене. */
export function nearestEdge(p, poly) {
  let best = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey;
    const len = Math.sqrt(len2);
    let t = len2 < 1e-12 ? 0 : ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2;
    t = Math.min(1, Math.max(0, t));
    const qx = a[0] + ex * t, qy = a[1] + ey * t;
    const dist = Math.hypot(p[0] - qx, p[1] - qy);
    if (best === null || dist < best.dist) {
      best = { index: i, t: t * len, dist, point: [qx, qy], length: len };
    }
  }
  return best;
}

/** Нормализовать полигон к обходу против часовой. */
export function normalizePolygon(poly) {
  return polygonArea(poly) < 0 ? [...poly].reverse() : [...poly];
}
