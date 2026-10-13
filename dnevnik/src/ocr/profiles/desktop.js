// Профиль: TradingView в браузере на компьютере. Откалибровано на реальных
// скриншотах (BTC/ETH/SOL, разные разрешения 1814×920 и 1472×920, LONG и
// SHORT) — см. ocr-test/samples и STATUS.md.
//
// searchFromPct держим БЛИЗКО к правому краю: у desktop полупрозрачная зона
// самого инструмента Long/Short тянется далеко влево, и при более широком
// поиске алгоритм принимает всю зону за один гигантский «шумный» блок.
export default {
  name: 'desktop',
  /** @returns {number} 0..1 — насколько скриншот похож на desktop (альбомная ориентация) */
  matchScore: (width, height) => (width > height ? 1 : 0),

  searchFromPct: 94.5,
  chromaMin: 10,
  brightMin: 60,
  minRunPx: 8,
  maxRunPx: 95,
  normalHeightMin: 14, // короче — шум (иконки, обрывки других элементов)
  normalHeightMax: 34, // длиннее — двухстрочная плашка (текущая цена + таймер)
};
