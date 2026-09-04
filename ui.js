// Строительные блоки интерфейса и панели шторки.
// Здесь нет состояния: панели получают сцену и объект действий (A) и только
// рисуют DOM. Всё, что меняет данные, живёт в app.js.

import { S, fmtCm, fmtSize } from './strings.js';
import { CATALOG, GROUPS, PALETTE, iconSvg } from './catalog.js';

/** Микро-гиперскрипт: h('div', {class:'x'}, 'текст', h('b', null, '!')) */
export function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export const clear = (node) => { while (node.firstChild) node.firstChild.remove(); };

export function section(title, ...kids) {
  return h('section', { class: 'sec' }, title ? h('h3', { text: title }) : null, ...kids);
}

/** Числовое поле с кнопками ±. Значение отдаётся целым числом сантиметров. */
export function numField({ label, value, step = 5, min = null, max = null, suffix = S.cm, onChange }) {
  const input = h('input', {
    type: 'number', inputmode: 'numeric', class: 'num',
    value: String(Math.round(value)), step: String(step),
    ...(min !== null ? { min: String(min) } : {}),
    ...(max !== null ? { max: String(max) } : {}),
  });

  const commit = () => {
    let v = parseFloat(input.value.replace(',', '.'));
    if (!Number.isFinite(v)) v = value;
    if (min !== null) v = Math.max(min, v);
    if (max !== null) v = Math.min(max, v);
    v = Math.round(v);
    input.value = String(v);
    onChange(v);
  };
  const nudge = (d) => {
    let v = (parseFloat(input.value.replace(',', '.')) || 0) + d;
    if (min !== null) v = Math.max(min, v);
    if (max !== null) v = Math.min(max, v);
    input.value = String(Math.round(v));
    onChange(Math.round(v));
  };

  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

  return h('label', { class: 'fld' },
    label ? h('span', { class: 'fld-lbl', text: label }) : null,
    h('span', { class: 'fld-row' },
      h('button', { class: 'step', type: 'button', 'aria-label': 'Меньше', onclick: () => nudge(-step) }, '−'),
      input,
      h('button', { class: 'step', type: 'button', 'aria-label': 'Больше', onclick: () => nudge(step) }, '+'),
      suffix ? h('span', { class: 'fld-suf', text: suffix }) : null,
    ),
  );
}

export function textField({ label, value, placeholder = '', onChange }) {
  const input = h('input', { type: 'text', class: 'txt', value: value || '', placeholder });
  const commit = () => onChange(input.value);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  return h('label', { class: 'fld' },
    label ? h('span', { class: 'fld-lbl', text: label }) : null,
    input,
  );
}

export function toggleRow({ label, on, onChange }) {
  const box = h('button', {
    class: 'tgl' + (on ? ' is-on' : ''), type: 'button',
    role: 'switch', 'aria-checked': String(!!on),
    onclick: () => onChange(!on),
  }, h('span', { class: 'tgl-knob' }));
  return h('div', { class: 'row row-tgl' }, h('span', { class: 'row-lbl', text: label }), box);
}

export function btn(label, opts = {}) {
  return h('button', {
    class: 'btn' + (opts.kind ? ' btn-' + opts.kind : '') + (opts.wide ? ' btn-wide' : ''),
    type: 'button', onclick: opts.onClick, ...(opts.disabled ? { disabled: true } : {}),
  }, label);
}

/** Кнопка, которая сначала спрашивает «Точно?» прямо в себе. */
export function confirmBtn(label, { kind = 'danger', onConfirm }) {
  let armed = false;
  const b = h('button', { class: `btn btn-${kind} btn-wide`, type: 'button' }, label);
  let timer = 0;
  b.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      b.textContent = S.confirmShort;
      b.classList.add('is-armed');
      timer = setTimeout(() => {
        armed = false; b.textContent = label; b.classList.remove('is-armed');
      }, 3000);
      return;
    }
    clearTimeout(timer);
    onConfirm();
  });
  return b;
}

export function hint(text) { return h('p', { class: 'hint', text }); }

// ---------------------------------------------------------------- панели

export function renderHintPanel() {
  return h('div', null,
    h('h2', { text: S.hintTitle }),
    hint(S.hintBody),
  );
}

/** Панель «Комната»: высота, пресет-прямоугольник, правка стен, вершины, ворота. */
export function renderRoomPanel(scene, A, ui) {
  const room = scene.room;
  const wrap = h('div', null, h('h2', { text: S.roomTitle }));

  wrap.append(section(null,
    numField({
      label: S.wallHeight, value: room.wallHeight, step: 10, min: 50, max: 1000,
      onChange: (v) => A.setWallHeight(v),
    }),
  ));

  // прямоугольник Д × Ш
  const rect = ui.rectDraft || { l: 1200, w: 600 };
  wrap.append(section(S.rectPreset,
    h('div', { class: 'grid2' },
      numField({ label: 'Д', value: rect.l, step: 10, min: 100, onChange: (v) => { rect.l = v; ui.rectDraft = rect; } }),
      numField({ label: 'Ш', value: rect.w, step: 10, min: 100, onChange: (v) => { rect.w = v; ui.rectDraft = rect; } }),
    ),
    hint(S.rectWarn),
    btn(S.rectApply, { wide: true, onClick: () => A.applyRect(rect.l, rect.w) }),
  ));

  // правка стен
  const edit = section(null,
    toggleRow({ label: S.editWalls, on: ui.wallEdit, onChange: (v) => A.setWallEdit(v) }),
    ui.wallEdit ? hint(S.editWallsHint) : null,
  );
  wrap.append(edit);

  // таблица вершин
  const table = h('table', { class: 'vtab' },
    h('thead', null, h('tr', null,
      h('th', { text: S.vertexNo }), h('th', { text: 'X' }), h('th', { text: 'Y' }), h('th', null),
    )),
  );
  const tbody = h('tbody');
  room.vertices.forEach(([x, y], i) => {
    const cell = (val, axis) => {
      const inp = h('input', { type: 'number', inputmode: 'numeric', class: 'num num-cell', value: String(Math.round(val)), step: '10' });
      const commit = () => {
        const v = parseFloat(inp.value.replace(',', '.'));
        if (!Number.isFinite(v)) { inp.value = String(Math.round(val)); return; }
        if (!A.setVertex(i, axis, Math.round(v))) inp.value = String(Math.round(val));
      };
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
      return h('td', null, inp);
    };
    tbody.append(h('tr', null,
      h('td', { class: 'vno', text: String(i + 1) }),
      cell(x, 0), cell(y, 1),
      h('td', null, h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Удалить вершину ${i + 1}`,
        ...(room.vertices.length <= 3 ? { disabled: true } : {}),
        onclick: () => A.removeVertex(i),
      }, '×')),
    ));
  });
  table.append(tbody);
  wrap.append(section(S.vertices, table));

  // ворота
  const gates = h('div', { class: 'gates' });
  const list = room.gates || [];
  if (!list.length) gates.append(hint(S.noGates));
  list.forEach((g) => {
    const edgeLen = A.edgeLength(g.edgeIndex);
    gates.append(h('div', { class: 'card' },
      h('div', { class: 'card-hd' },
        h('strong', { text: g.label || S.gateDefaultLabel }),
        h('span', { class: 'card-sub', text: `стена ${g.edgeIndex + 1}` }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Удалить ворота', onclick: () => A.removeGate(g.id) }, '×'),
      ),
      h('div', { class: 'grid2' },
        numField({ label: S.gateOffset, value: g.offset, step: 10, min: 0, max: Math.max(0, edgeLen - g.width), onChange: (v) => A.setGate(g.id, { offset: v }) }),
        numField({ label: S.gateWidth, value: g.width, step: 10, min: 30, max: edgeLen, onChange: (v) => A.setGate(g.id, { width: v }) }),
      ),
      textField({ label: S.gateLabel, value: g.label, onChange: (v) => A.setGate(g.id, { label: v }) }),
    ));
  });
  gates.append(ui.gatePick
    ? hint(S.gatePickWall)
    : btn('+ ' + S.addGate, { wide: true, onClick: () => A.startGatePick() }));
  wrap.append(section(S.gates, gates));

  return wrap;
}

/** Панель «+ Добавить»: карточки каталога по группам. */
export function renderAddPanel(A) {
  const wrap = h('div', null, h('h2', { text: S.catalogTitle }));

  for (const g of GROUPS) {
    const items = CATALOG.filter((c) => c.group === g.key);
    if (!items.length) continue;
    const grid = h('div', { class: 'cat-grid' });
    for (const c of items) {
      const card = h('button', { class: 'cat-card', type: 'button', onclick: () => A.addObject(c.key) },
        h('span', { class: 'cat-ico' }),
        h('span', { class: 'cat-name', text: c.name }),
        h('span', { class: 'cat-dim', text: `${c.l}×${c.w}×${c.h}` }),
        c.note ? h('span', { class: 'cat-note', text: c.note }) : null,
      );
      card.querySelector('.cat-ico').innerHTML = iconSvg(c);
      grid.append(card);
    }
    wrap.append(section(g.title, grid));
  }
  return wrap;
}

/** Панель свойств выбранного объекта. */
export function renderPropsPanel(obj, A) {
  if (!obj) return h('div', null, h('h2', { text: S.propsTitle }), hint(S.nothingSelected));

  const wrap = h('div', null, h('h2', { text: obj.name || S.propsTitle }));

  wrap.append(section(null,
    textField({ label: S.name, value: obj.name, onChange: (v) => A.patch(obj.id, { name: v }) }),
  ));

  wrap.append(section(null,
    numField({ label: S.dimL, value: obj.l, step: 5, min: 5, onChange: (v) => A.patch(obj.id, { l: v }) }),
    numField({ label: S.dimW, value: obj.w, step: 5, min: 5, onChange: (v) => A.patch(obj.id, { w: v }) }),
    numField({ label: S.dimH, value: obj.h, step: 5, min: 5, onChange: (v) => A.patch(obj.id, { h: v }) }),
  ));

  wrap.append(section(S.rotation,
    h('div', { class: 'row' },
      btn('↺ 90°', { onClick: () => A.rotate(obj.id, 90) }),
      h('span', { class: 'rot-val', text: `${((obj.rot % 360) + 360) % 360}°` }),
      btn('90° ↻', { onClick: () => A.rotate(obj.id, -90) }),
    ),
  ));

  const sw = h('div', { class: 'swatches' });
  for (const col of PALETTE) {
    const b = h('button', {
      class: 'swatch' + (col.toLowerCase() === (obj.color || '').toLowerCase() ? ' is-on' : ''),
      type: 'button', 'aria-label': `Цвет ${col}`,
      onclick: () => A.patch(obj.id, { color: col }),
    });
    b.style.setProperty('--sw', col);
    sw.append(b);
  }
  wrap.append(section(S.color, sw));

  wrap.append(section(null,
    toggleRow({
      label: S.translucent, on: (obj.opacity ?? 1) < 1,
      onChange: (v) => A.patch(obj.id, { opacity: v ? 0.4 : 1 }),
    }),
  ));

  const cl = obj.clearance || { on: false, margin: 80 };
  wrap.append(section(null,
    toggleRow({
      label: S.clearance, on: !!cl.on,
      onChange: (v) => A.patch(obj.id, { clearance: { ...cl, on: v } }),
    }),
    cl.on
      ? numField({
          label: S.clearanceMargin, value: cl.margin, step: 10, min: 0, max: 300,
          onChange: (v) => A.patch(obj.id, { clearance: { ...cl, margin: v } }),
        })
      : null,
  ));

  wrap.append(section(null,
    btn(S.duplicate, { wide: true, onClick: () => A.duplicate(obj.id) }),
    btn(S.resetSize, { wide: true, onClick: () => A.resetSize(obj.id) }),
    confirmBtn(S.del, { onConfirm: () => A.remove(obj.id) }),
  ));

  return wrap;
}
