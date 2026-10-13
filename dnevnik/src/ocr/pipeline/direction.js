// Направление Long/Short — по геометрии, а не по тексту. На реальных
// скриншотах слово LONG/SHORT физически не печатается инструментом
// риск/прибыль TradingView, поэтому искать его через OCR бессмысленно в
// принципе (проверено на всех 5 тестовых скриншотах — текста нет ни на
// одном). Единственный надёжный признак, уже доступный без лишнего OCR, —
// взаимное расположение уже найденных плашек Stop/Entry по вертикали:
//   Stop ВЫШЕ Entry на экране (меньше Y) → Short (стоп при росте цены)
//   Stop НИЖЕ Entry на экране (больше Y) → Long (стоп при падении цены)
// Подтверждено на INJ (реальный Short, Stop-плашка выше Entry) и BTC
// (реальный Short: цена Stop 77151,2 > Entry 77052,4 — выше на графике).
const MIN_GAP_PX = 4; // плашки почти на одной высоте — не различить, не гадаем

/**
 * @param {number|null|undefined} entryYCenter
 * @param {number|null|undefined} stopYCenter
 * @returns {'long'|'short'|null}
 */
export function detectDirection(entryYCenter, stopYCenter) {
  if (entryYCenter == null || stopYCenter == null) return null;
  const gap = stopYCenter - entryYCenter;
  if (Math.abs(gap) < MIN_GAP_PX) return null;
  return gap < 0 ? 'short' : 'long';
}
