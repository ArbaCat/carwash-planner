// Все строки интерфейса — здесь. Чтобы добавить словацкий, скопируй объект и подмени значения.

export const S = {
  appName: 'Планировщик мойки',

  // виды
  viewTop: 'Сверху',
  view3d: '3D',

  // тулбар
  undo: 'Отменить',
  redo: 'Вернуть',
  add: 'Добавить',
  room: 'Комната',
  variants: 'Варианты',
  more: 'Ещё',

  // меню «Ещё»
  exportJson: 'Экспорт JSON',
  importJson: 'Импорт JSON',
  copyJson: 'Скопировать JSON',
  screenshot: 'Скриншот PNG',
  reset: 'Сбросить всё',

  // подсказка первого запуска
  hintTitle: 'С чего начать',
  hintBody: 'Задай комнату → добавь машину → посмотри сверху и в 3D.',

  // каталог
  catalogTitle: 'Что добавить',
  catCars: 'Транспорт',
  catEquip: 'Оборудование',
  catOther: 'Прочее',

  // свойства объекта
  propsTitle: 'Объект',
  name: 'Название',
  dimL: 'Длина',
  dimW: 'Ширина',
  dimH: 'Высота',
  rotation: 'Поворот',
  rotLeft: 'Повернуть влево на 90°',
  rotRight: 'Повернуть вправо на 90°',
  color: 'Цвет',
  translucent: 'Полупрозрачный',
  clearance: 'Зона обслуживания',
  clearanceMargin: 'Отступ',
  duplicate: 'Дублировать',
  resetSize: 'Сбросить размеры',
  del: 'Удалить',
  confirmShort: 'Точно?',
  nothingSelected: 'Ничего не выбрано. Тапни объект в виде сверху.',

  // комната
  roomTitle: 'Комната',
  wallHeight: 'Высота стен',
  rectPreset: 'Прямоугольник',
  rectApply: 'Применить',
  rectWarn: 'Вершины комнаты будут заданы заново. Объекты останутся на местах.',
  editWalls: 'Правка стен',
  editWallsHint: 'Тяни вершины, тапай + на середине стены, чтобы добавить вершину. Долгий тап по вершине — удалить.',
  vertices: 'Вершины',
  vertexNo: '№',
  gates: 'Ворота',
  addGate: 'Ворота',
  gatePickWall: 'Тапни стену в виде сверху',
  gateOffset: 'Отступ',
  gateWidth: 'Ширина',
  gateLabel: 'Подпись',
  gateDefaultLabel: 'Въезд',
  noGates: 'Ворот нет',

  // варианты
  variantsTitle: 'Варианты',
  newVariant: 'Новый',
  dupVariant: 'Дублировать текущий',
  renameVariant: 'Переименовать',
  delVariant: 'Удалить',
  variantA: 'Вариант A',

  // тосты и ошибки
  errImportShape: 'Файл не похож на сцену carwash-planner',
  errImportVersion: (v) => `Файл версии ${v}, приложение понимает версию 1`,
  errQuota: 'В браузере не осталось места. Удали лишние варианты или сохрани экспортом.',
  errNoStorage: 'Сохранение в браузере недоступно, пользуйся экспортом',
  errWebgl: 'Потерян контекст 3D. Перезагрузи страницу — сцена сохранена.',
  errSelfIntersect: 'Так стены пересекутся сами с собой',
  errMinVertices: 'Меньше трёх вершин комната не бывает',
  okCopied: 'JSON скопирован',
  okImported: 'Сцена загружена как новый вариант',
  okSaved: 'Файл сохранён',
  pasteJsonHere: '…или вставь JSON сюда',
  importBtn: 'Загрузить',

  // единицы
  cm: 'см',
  m: 'м',
};

// «460 см · 4,6 м» — метры дублируем от метра и больше
export function fmtCm(v) {
  const n = Math.round(v);
  if (Math.abs(n) < 100) return `${n} ${S.cm}`;
  const m = (n / 100).toFixed(n % 100 === 0 ? 0 : (n % 10 === 0 ? 1 : 2));
  return `${n} ${S.cm} · ${m.replace('.', ',')} ${S.m}`;
}

// короткая форма для подписей на плане: «460×180»
export function fmtSize(l, w) {
  return `${Math.round(l)}×${Math.round(w)}`;
}
