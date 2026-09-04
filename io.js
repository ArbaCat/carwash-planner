// Экспорт и импорт сцены, снимок вида в PNG, отдача файла наружу.
// Сеть не используется: только Blob, буфер обмена и системная шара.

import { validateScene } from './storage.js';

const pad2 = (n) => String(n).padStart(2, '0');

/** Локальная дата в виде 2026-09-04. */
export function today(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Имя файла без того, что ломает файловые системы. */
export function safeName(s) {
  return String(s || 'вариант')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'вариант';
}

export const sceneFileName = (scene) => `carwash-${safeName(scene.name)}-${today()}.json`;
export const shotFileName = (scene, view) => `carwash-${safeName(scene.name)}-${view}-${today()}.png`;

/** Отдать файл: сначала системная шара (на iPad уходит в Файлы, Telegram,
 *  AirDrop), иначе обычная ссылка на скачивание. */
export async function deliver(blob, filename, type) {
  try {
    const file = new File([blob], filename, { type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
    // шара недоступна или отказала — падаем на скачивание
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

export const sceneJson = (scene) => JSON.stringify(scene, null, 2);

export async function exportScene(scene) {
  const text = sceneJson(scene);
  return deliver(new Blob([text], { type: 'application/json' }),
                 sceneFileName(scene), 'application/json');
}

export async function copyJson(scene) {
  const text = sceneJson(scene);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Safari без разрешения на буфер — старый приём через скрытое поле
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Разобрать текст в сцену. { ok, scene } или { ok:false, error }. */
export function parseScene(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'shape' }; }
  return validateScene(raw);
}

// ---------------------------------------------------------------- снимок

/** Скруглённый прямоугольник — фон подписи. */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Снимок текущего вида вместе с подписями.
 *
 *  Подписи — это HTML поверх канваса, в самом WebGL их нет. preserveDrawingBuffer
 *  включать не хочется (он стоит производительности на каждом кадре), поэтому
 *  кадр рисуется прямо перед снятием, тут же копируется на офскрин, а подписи
 *  доводятся сверху по спроецированным координатам. */
export function snapshot(sc, insets = null) {
  const gl = sc.renderer.domElement;
  sc.drawNow();                                  // свежий кадр, синхронно

  const dpr = gl.clientWidth ? gl.width / gl.clientWidth : 1;

  // Режем по той полосе, которую пользователь реально видит: канвас во весь
  // экран, и без обрезки в файл уезжала бы пустая треть из-под шторки.
  const ins = insets || { top: 0, bottom: 0, left: 0, right: 0 };
  const sx = Math.round(ins.left * dpr);
  const sy = Math.round(ins.top * dpr);
  const sw = Math.max(1, gl.width - Math.round((ins.left + ins.right) * dpr));
  const sh = Math.max(1, gl.height - Math.round((ins.top + ins.bottom) * dpr));

  const off = document.createElement('canvas');
  off.width = sw;
  off.height = sh;
  const ctx = off.getContext('2d');
  ctx.drawImage(gl, sx, sy, sw, sh, 0, 0, sw, sh);
  const cam = sc.getMode() === 'top' ? sc.cameras.top : sc.cameras.persp;
  cam.updateMatrixWorld();
  const v = new sc.THREE.Vector3();

  sc.scene.traverse((n) => {
    if (!n.isCSS2DObject || !n.element || !n.visible) return;
    for (let p = n.parent; p; p = p.parent) if (!p.visible) return;

    n.getWorldPosition(v).project(cam);
    if (v.z < -1 || v.z > 1) return;
    // проекция даёт координаты полного канваса — сдвигаем в систему вырезки
    const x = ((v.x + 1) / 2) * gl.width - sx;
    const y = ((-v.y + 1) / 2) * gl.height - sy;
    if (x < -200 || y < -200 || x > sw + 200 || y > sh + 200) return;

    const el = n.element;
    const small = el.querySelector('small');
    const main = (small ? el.firstChild?.textContent : el.textContent) || '';
    const sub = small?.textContent || '';
    const isDist = el.classList.contains('is-dist');
    const above = el.classList.contains('is-above');

    const fs = 12 * dpr, fsSub = 11 * dpr;
    ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    const wMain = ctx.measureText(main).width;
    ctx.font = `500 ${fsSub}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    const wSub = sub ? ctx.measureText(sub).width : 0;

    const padX = 6 * dpr, padY = 3 * dpr, gap = 2 * dpr;
    const boxW = Math.max(wMain, wSub) + padX * 2;
    const boxH = fs + (sub ? fsSub + gap : 0) + padY * 2;
    // те же сдвиги, что и в CSS: по центру, а у мелких объектов — выше
    const bx = x - boxW / 2;
    const by = above ? y - boxH * 1.85 : y - boxH / 2;

    ctx.fillStyle = isDist ? 'rgba(27,31,36,.88)' : 'rgba(255,255,255,.86)';
    roundRect(ctx, bx, by, boxW, boxH, 5 * dpr);
    ctx.fill();

    ctx.fillStyle = isDist ? '#ffffff' : '#1b1f24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(main, x, by + padY);
    if (sub) {
      ctx.globalAlpha = 0.72;
      ctx.font = `500 ${fsSub}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(sub, x, by + padY + fs + gap);
      ctx.globalAlpha = 1;
    }
  });

  return off;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(b), 'image/png');
    else {
      const data = canvas.toDataURL('image/png').split(',')[1];
      const bin = atob(data);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      resolve(new Blob([buf], { type: 'image/png' }));
    }
  });
}

export async function exportShot(sc, scene, insets = null) {
  const view = sc.getMode() === 'top' ? 'сверху' : '3d';
  const blob = await canvasToBlob(snapshot(sc, insets));
  return deliver(blob, shotFileName(scene, view), 'image/png');
}
