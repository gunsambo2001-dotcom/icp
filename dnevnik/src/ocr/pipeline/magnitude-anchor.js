// Независимая проверка ПРАВДОПОДОБИЯ величины Entry/Stop/Target — не путать
// с decimal-anchor.js (тот определяет ГДЕ поставить разделитель; этот —
// похоже ли само число на цену, которая реально на экране).
//
// ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ПРОВЕРКА: разбор ETH показал, что Tesseract может
// уверенно и «чисто» прочитать не тот символ (напр. «2 486,70» → «12486,70»,
// «2 452,33» → «245,33») — crop верный, разделитель верный, посторонних
// символов нет, кандидат один. Ни один из существующих признаков
// (guessedSeparator/hadStrayChars/ambiguousCount/высота плашки) такую
// ошибку не ловит, потому что все они про «пришлось ли гадать», а не про
// «похоже ли число на то, что должно быть». Единственный способ поймать —
// сравнить порядок величины с независимыми числами на этом же скриншоте.
//
// Числа со знаком +/- перед собой не берём в ориентиры — это дельты
// изменения цены (напр. «-2,10»), у них закономерно другой порядок
// величины, чем у самой цены (ETH: цена ~2487, дельта ~2,10).
const NUMBER_WITH_SEPARATOR = /\d{1,6}[.,]\d{1,8}/g;
const MIN_ANCHORS = 3; // меньше — ориентир слишком шаткий, лучше не флагать вслепую
const MODE_SHARE_MIN = 0.7; // доля ориентиров, которая должна совпадать по числу разрядов
const RANGE_MARGIN_MULT = 3; // во сколько раз шире видимого диапазона шкалы допустимо (стоп/тейк бывают за пределами видимого графика)

function collectAnchors(fullText) {
  const anchors = [];
  const re = new RegExp(NUMBER_WITH_SEPARATOR);
  let m;
  while ((m = re.exec(fullText))) {
    const token = m[0];
    const afterIdx = re.lastIndex;
    if (fullText[afterIdx] === '%') continue; // проценты — не цена
    const before = fullText[m.index - 1];
    if (before === '+' || before === '-') continue; // дельта, не сама цена
    const sepIdx = token.search(/[.,]/);
    const value = Number(token.replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    anchors.push({ token, integerDigits: sepIdx, value });
  }
  return anchors;
}

function mode(numbers) {
  const counts = new Map();
  for (const n of numbers) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best = null, bestCount = 0;
  for (const [n, c] of counts) if (c > bestCount) { best = n; bestCount = c; }
  return { value: best, count: bestCount, total: numbers.length };
}

/**
 * Строит ориентир правдоподобия по полнотекстовому OCR этого скриншота
 * (шкала цены справа, OHLC-значения в шапке). Если независимых чисел мало
 * или они сильно расходятся в порядке величины — ориентир считается
 * ненадёжным (integerDigits: null), и checkMagnitude ничего не флагает:
 * лучше промолчать, чем сравнивать с шатким эталоном.
 * @param {string} fullText
 */
export function buildMagnitudeReference(fullText) {
  const anchors = collectAnchors(fullText);
  if (anchors.length < MIN_ANCHORS) {
    return { integerDigits: null, range: null, anchorCount: anchors.length };
  }
  const digitMode = mode(anchors.map((a) => a.integerDigits));
  const integerDigits = digitMode.count / digitMode.total >= MODE_SHARE_MIN ? digitMode.value : null;
  const values = anchors.map((a) => a.value);
  return { integerDigits, range: [Math.min(...values), Math.max(...values)], anchorCount: anchors.length };
}

/**
 * @param {number|null} value
 * @param {{integerDigits:number|null, range:[number,number]|null}} reference
 * @returns {string|null} причина подозрения, либо null (включая случай ненадёжного ориентира)
 */
export function checkMagnitude(value, reference) {
  if (value == null || reference?.integerDigits == null) return null;

  const valueIntegerDigits = Math.max(1, String(Math.trunc(Math.abs(value))).length);
  if (valueIntegerDigits !== reference.integerDigits) {
    return `число разрядов до запятой (${valueIntegerDigits}) не совпадает со шкалой цены на этом скриншоте (${reference.integerDigits}) — похоже на ошибку OCR в одной цифре, а не на реальную цену`;
  }

  const [lo, hi] = reference.range;
  const span = hi - lo || hi || 1;
  if (value < lo - span * RANGE_MARGIN_MULT || value > hi + span * RANGE_MARGIN_MULT) {
    return 'значение далеко за пределами видимого на скриншоте диапазона цены';
  }
  return null;
}
