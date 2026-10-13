// Профиль: мобильное приложение TradingView (скриншот с телефона, часто
// дополнительно пережат мессенджером при пересылке — проверено на реальном
// JPEG через Telegram, 573×1280).
//
// searchFromPct берём ШИРЕ, чем у desktop: у мелких монет цена длиннее
// (больше значащих цифр после запятой, напр. «0,0034496»), и плашка занимает
// больше места по ширине. Зона самого инструмента на мобильном не тянется
// так далеко влево, поэтому широкий поиск здесь не цепляет её целиком (в
// отличие от desktop — см. profiles/desktop.js).
export default {
  name: 'mobile',
  /** @returns {number} 0..1 — насколько скриншот похож на mobile (портретная ориентация) */
  matchScore: (width, height) => (height > width ? 1 : 0),

  searchFromPct: 75,
  chromaMin: 10,
  brightMin: 60,
  minRunPx: 8,
  maxRunPx: 180,
  normalHeightMin: 14,
  normalHeightMax: 40,
};
