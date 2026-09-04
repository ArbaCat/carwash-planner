// Оркестрация: состояние, жесты, интерфейс. Математика — geometry.js,
// рендер — scene3d.js, тексты — strings.js.

import { createScene } from './scene3d.js';
import { S } from './strings.js';

const $ = (sel) => document.querySelector(sel);

const el = {
  stage:      $('#stage'),
  canvasHost: $('#canvas-host'),
  labelHost:  $('#label-host'),
  toolbar:    $('#toolbar'),
  sheet:      $('#sheet'),
  sheetGrab:  $('#sheet-grab'),
  sheetBody:  $('#sheet-body'),
  toastHost:  $('#toast-host'),
  variantName: $('#variant-name'),
  btnTop:  $('#btn-view-top'),
  btn3d:   $('#btn-view-3d'),
};

// ---- тач-гигиена: страница не должна зумиться и «дёргаться» ------------

// Safari: pinch-zoom страницы
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => {
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
});

// двойной тап -> зум страницы
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 320) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// оттягивание страницы за канвас
el.canvasHost.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ---- тосты -------------------------------------------------------------

export function toast(text, kind = '') {
  const node = document.createElement('div');
  node.className = 'toast' + (kind ? ' is-' + kind : '');
  node.textContent = text;
  el.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

// ---- шторка ------------------------------------------------------------

const sheet = {
  open(html) {
    if (html !== undefined) el.sheetBody.innerHTML = html;
    el.sheet.classList.remove('is-collapsed');
    el.sheetGrab.setAttribute('aria-label', 'Свернуть панель');
  },
  close() {
    el.sheet.classList.add('is-collapsed');
    el.sheetGrab.setAttribute('aria-label', 'Развернуть панель');
  },
  toggle() {
    el.sheet.classList.contains('is-collapsed') ? this.open() : this.close();
  },
  isOpen() { return !el.sheet.classList.contains('is-collapsed'); },
};
el.sheetGrab.addEventListener('click', () => sheet.toggle());

// ---- сцена -------------------------------------------------------------

const sc = createScene({ canvasHost: el.canvasHost, labelHost: el.labelHost });

sc.onContextLost(() => toast(S.errWebgl, 'err'));

function fitCanvas() {
  const r = el.canvasHost.getBoundingClientRect();
  sc.resize(r.width, r.height);
}
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCanvas);

// ---- старт -------------------------------------------------------------

// Комната по умолчанию — до появления хранилища (шаг 7 ТЗ).
const DEFAULT_ROOM = { w: 1200, d: 600 };

function boot() {
  fitCanvas();
  sc.buildGrid(0, 0, DEFAULT_ROOM.w, DEFAULT_ROOM.d);

  // вписать комнату в кадр с запасом
  const { w, h } = sc.getSize();
  const pad = 1.25;
  const pxPerCm = Math.min(w / (DEFAULT_ROOM.w * pad), h / (DEFAULT_ROOM.d * pad));
  sc.setTopView(DEFAULT_ROOM.w / 2, DEFAULT_ROOM.d / 2, pxPerCm);

  el.variantName.textContent = S.variantA;
  sheet.open(`<h2>${S.hintTitle}</h2><p>${S.hintBody}</p>`);

  el.btnTop.addEventListener('click', () => setView('top'));
  el.btn3d.addEventListener('click', () => setView('3d'));
}

function setView(mode) {
  sc.setMode(mode);
  el.btnTop.classList.toggle('is-on', mode === 'top');
  el.btn3d.classList.toggle('is-on', mode === '3d');
  el.btnTop.setAttribute('aria-selected', String(mode === 'top'));
  el.btn3d.setAttribute('aria-selected', String(mode === '3d'));
}

boot();
