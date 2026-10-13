// Сырой текст OCR одной плашки → число + метаданные о том, насколько пришлось
// «догадываться». Метаданные идут в оценку confidence (result.js) — не
// зашиты в fixed high/medium/low здесь, чтобы уверенность считалась по
// реальным признакам, а не подгонялась под конкретные тестовые скриншоты.
//
// НАХОДКА С ТЕСТОВ: OCR иногда теряет запятую-разделитель («771512» вместо
// «77151,2» или, у INJ, «5901» вместо «5,901»). Раньше здесь была эвристика
// «достраиваем запятую перед последней цифрой» — она молча ломала цену для
// любой пары, где после запятой не ровно один знак (INJ — 3 знака, мелкие
// монеты — до 7, см. profiles/mobile.js). Слепых предположений больше нет:
// разделитель восстанавливается ТОЛЬКО когда известно количество знаков
// после запятой на этом скриншоте (см. decimal-anchor.js) — иначе значение
// не распознаётся (value: null) и требует ручного ввода, а не выдаёт
// правдоподобное, но случайное число.
export function normalizePriceText(raw, decimalDigits = null) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { value: null, guessedSeparator: false, hadStrayChars: false, cleanText: '' };
  }

  const cleaned = trimmed.replace(/[^\d.,]/g, '');
  const hadStrayChars = cleaned.length !== trimmed.length;

  let numeric;
  let guessedSeparator = false;
  if (/^\d+$/.test(cleaned) && cleaned.length >= 3) {
    // чистые цифры без разделителя — разделитель ставим только по якорю,
    // а не гадаем позицию сами
    if (decimalDigits == null || decimalDigits >= cleaned.length) {
      return { value: null, guessedSeparator: false, hadStrayChars, cleanText: cleaned };
    }
    numeric = `${cleaned.slice(0, -decimalDigits)}.${cleaned.slice(-decimalDigits)}`;
    guessedSeparator = true;
  } else {
    numeric = cleaned.replace(',', '.');
  }

  const value = Number(numeric);
  return {
    value: Number.isFinite(value) ? value : null,
    guessedSeparator,
    hadStrayChars,
    cleanText: cleaned,
  };
}
