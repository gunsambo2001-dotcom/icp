// Сборка итогового результата + оценка confidence по РЕАЛЬНЫМ признакам
// качества конкретного распознавания (не подогнано под тестовые скриншоты).
//
// ВАЖНАЯ НАХОДКА С ТЕСТОВ: data.confidence от самого Tesseract на таких
// маленьких обрезках (однострочные ценовые плашки) практически не
// коррелирует с реальной правильностью — на разных скриншотах видели 0-6%
// на идеально верных значениях и 90% на кандидате, который на деле был
// лишним шумовым дублем. Поэтому он НЕ используется как основа для
// high/medium/low — только сохраняется в debug для прозрачности. Реальные
// сигналы:
//  - пришлось ли достраивать разделитель запятой (см. normalize.js);
//  - были ли в сыром тексте посторонние символы;
//  - высота плашки близко к границе допустимого диапазона профиля
//    (значит, деление на «однострочная / шум / текущая цена» было на грани);
//  - однозначен ли кандидат на поле (если полос с одним значением найдено
//    несколько — confidence падает, даже если сам текст выглядел чисто);
//  - согласованность между Entry/Stop/Target (см. crossFieldSanity ниже).
//
// Ни один набор проверок не ловит 100% ошибок (напр., «тихая» подмена одной
// цифры внутри иначе правильно оформленного числа) — это НЕ повод считать
// систему сломанной, а причина, почему подтверждение учеником обязательно
// всегда, а не только когда confidence низкий.
const EDGE_MARGIN_PX = 3;

export function downgrade(level) {
  return level === 'high' ? 'medium' : 'low';
}

/**
 * @param {{ guessedSeparator:boolean, hadStrayChars:boolean, heightPx:number, ambiguousCount:number }} signals
 * @param {import('./profiles/index.js').OcrProfile} profile
 */
export function scoreField(signals, profile) {
  const { guessedSeparator, hadStrayChars, heightPx, ambiguousCount } = signals;
  let level = 'high';
  const notes = [];

  if (guessedSeparator) { level = downgrade(level); notes.push('запятая-разделитель восстановлена по числу знаков на этом скриншоте, а не распознана напрямую в цифре'); }
  if (hadStrayChars) { level = downgrade(level); notes.push('в сыром тексте были посторонние символы'); }
  if (signals.digitCount < 3) { level = downgrade(level); notes.push('слишком короткий текст для цены — вероятно, обрезок'); }

  const nearMin = heightPx - profile.normalHeightMin < EDGE_MARGIN_PX;
  const nearMax = profile.normalHeightMax - heightPx < EDGE_MARGIN_PX;
  if (nearMin || nearMax) { level = downgrade(level); notes.push('высота плашки на границе допустимого диапазона'); }

  if (ambiguousCount > 1) { level = downgrade(level); notes.push(`найдено ${ambiguousCount} похожих плашек на это поле — выбрана наиболее типичная по размеру`); }

  return { level, notes };
}

/** Насколько высота плашки близка к «типичной» середине диапазона профиля — используется для выбора среди дублей-кандидатов. */
function typicalityScore(heightPx, profile) {
  const mid = (profile.normalHeightMin + profile.normalHeightMax) / 2;
  return -Math.abs(heightPx - mid);
}

/**
 * Проверка «на здравый смысл»: риск (|Stop-Entry|) и потенциальная прибыль
 * (|Target-Entry|) не должны отличаться на порядки — иначе, скорее всего,
 * OCR потерял/добавил цифру в одном из полей (ровно так вскрылась ошибка в
 * тесте на ETH-скриншоте: незаметная порознь, но абсурдный RR почти 1:206).
 */
export function crossFieldSanity(entry, stop, target) {
  if (entry == null || stop == null || target == null) return { ok: true, reason: null };
  const risk = Math.abs(stop - entry);
  const reward = Math.abs(target - entry);
  if (risk === 0) return { ok: false, reason: 'Stop совпадает с Entry' };
  const rr = reward / risk;
  if (rr < 0.05 || rr > 30) {
    return { ok: false, reason: `нетипичное соотношение риск/прибыль (1:${rr.toFixed(1)}) — вероятна ошибка в одной из цифр` };
  }
  return { ok: true, reason: null };
}

/**
 * Проверка «согласуется ли направление с расположением уровней»: у Long
 * Stop обязан быть ниже Entry, а Target — выше (обратное — у Short).
 * Направление здесь берётся из геометрии (direction.js), а не из этой
 * проверки — если что-то не сходится, мы не знаем, ошиблось ли направление
 * или сама цена, поэтому помечаем ОБЕ стороны и оставляем решение человеку.
 */
export function checkDirectionLevels(entry, stop, target, direction) {
  if (entry == null || direction == null) return { stopOk: true, targetOk: true };
  const stopOk = stop == null || (direction === 'long' ? stop <= entry : stop >= entry);
  const targetOk = target == null || (direction === 'long' ? target >= entry : target <= entry);
  return { stopOk, targetOk };
}

/**
 * Собирает лучшего кандидата на поле из списка (может быть >1 из-за шума
 * или случайной одноцветной плашки в другом месте скриншота) и считает его
 * confidence. Если известна Y-координата уже разрешённого Entry (nearY) —
 * это основной критерий выбора (настоящие Entry/Stop/Target всегда рядом
 * друг с другом по вертикали), высота плашки — только подстраховка, когда
 * nearY недоступен или кандидаты равно близки.
 */
export function pickBestCandidate(candidates, profile, { nearY } = {}) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (nearY != null) {
      const d = Math.abs(a.yCenter - nearY) - Math.abs(b.yCenter - nearY);
      if (d !== 0) return d;
    }
    return typicalityScore(b.heightPx, profile) - typicalityScore(a.heightPx, profile);
  });
  const best = sorted[0];
  const { level, notes } = scoreField({ ...best, ambiguousCount: candidates.length }, profile);
  return { ...best, confidence: level, notes };
}
