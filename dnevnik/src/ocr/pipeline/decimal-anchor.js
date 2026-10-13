// Независимый якорь для восстановления потерянного разделителя в
// Entry/Stop/Target: ищем на этом же скриншоте числа, у которых Tesseract
// НЕ потерял разделитель (текущая цена, сумма изменения цены, разметка
// шкалы цен справа), и берём их количество знаков после разделителя.
//
// НАХОДКА С ТЕСТА НА INJ: сама «текущая цена» в шапке иногда тоже теряет
// разделитель («5904» вместо «5,904»), поэтому якорем служит не одно поле,
// а ВСЕ подходящие числа на скриншоте сразу — на реальных скриншотах
// (BTC/ETH/SOL/PEPE/INJ) они единогласно совпадают по числу знаков после
// разделителя (1, 2, 3, 7 соответственно), потому что вся разметка цены на
// TradingView для одной пары рисуется с одинаковой точностью. Если хотя бы
// одно число расходится с остальными — считаем якорь ненадёжным и НЕ гадаем.
//
// Процент изменения («+0,08%») исключаем явно: его точность отображения не
// связана с точностью цены и на разных скриншотах не совпадает с ней.
const NUMBER_WITH_SEPARATOR = /\d{1,6}[.,]\d{1,8}/g;

export function detectDecimalAnchor(fullText) {
  const matches = [];
  let m;
  const re = new RegExp(NUMBER_WITH_SEPARATOR);
  while ((m = re.exec(fullText))) {
    const token = m[0];
    const afterIdx = re.lastIndex;
    if (fullText[afterIdx] === '%') continue; // сумма% — точность не связана с ценой
    const sepIdx = token.search(/[.,]/);
    matches.push({ token, decimalDigits: token.length - sepIdx - 1 });
  }

  if (!matches.length) {
    return { decimalDigits: null, matches: [], ambiguous: false };
  }

  const counts = new Set(matches.map((m) => m.decimalDigits));
  if (counts.size > 1) {
    return { decimalDigits: null, matches: matches.map((m) => m.token), ambiguous: true };
  }
  return { decimalDigits: [...counts][0], matches: matches.map((m) => m.token), ambiguous: false };
}
