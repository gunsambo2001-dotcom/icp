// Публичная точка входа OCR-модуля.
//
// screenshot → OCR → draft (entry/stop/target/пара/направление/таймфрейм,
// каждое поле — с confidence и «сырыми» данными для проверки) → ДАЛЬШЕ
// решает вызывающий код: показать экран проверки ученику, дать
// поправить/подтвердить и только потом передать в обычную форму сделки
// (store.createTrade). Этот модуль сам никогда никуда не пишет и не решает,
// что сохранять — только распознаёт и оценивает уверенность.
import { createWorker } from 'tesseract.js';
import { detectFormat } from './detect-format.js';
import { findColorBands } from './pipeline/color-bands.js';
import { ocrBand } from './pipeline/crop-and-ocr.js';
import { normalizePriceText } from './pipeline/normalize.js';
import { parseHeader } from './pipeline/parse-header.js';
import { detectDecimalAnchor } from './pipeline/decimal-anchor.js';
import { buildMagnitudeReference, checkMagnitude } from './pipeline/magnitude-anchor.js';
import { joinThousandsSpaces } from './pipeline/join-thousands.js';
import { normalizePair } from './pipeline/normalize-pair.js';
import { detectDirection } from './pipeline/direction.js';
import { FIELD_BY_BUCKET } from './pipeline/classify-color.js';
import { pickBestCandidate, crossFieldSanity, checkDirectionLevels, downgrade } from './result.js';

const DIGIT_WHITELIST = '0123456789.,-+%()';

// В браузере воркер, ядро и языковые данные берём со своего сайта (vendor/, eng.traineddata),
// а не с CDN jsDelivr — он у части провайдеров РФ заблокирован. В Node (тесты) — как раньше.
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node;
const BROWSER_WORKER_OPTIONS = IS_NODE ? undefined : {
  workerPath: new URL('../../vendor/tesseract/worker.min.js', import.meta.url).href,
  corePath: new URL('../../vendor/tesseract/', import.meta.url).href,
  langPath: new URL('../../', import.meta.url).href,
  gzip: false,
};

const newWorker = () => createWorker('eng', 1, BROWSER_WORKER_OPTIONS);

/**
 * @param {{width:number, height:number, getPixel:Function, cropDataUrl:Function, fullDataUrl:Function}} image
 *        — см. adapters/node-image.js (тесты) или adapters/browser-image.js (приложение)
 */
export async function recognizeScreenshot(image) {
  const { profile, formatConfident, scores } = detectFormat(image.width, image.height);

  // Полнотекстовый проход по всей картинке — используется и для заголовка
  // (пара/направление/таймфрейм), и как источник якоря количества знаков
  // после запятой (см. decimal-anchor.js), поэтому запускаем его первым,
  // до распознавания плашек Entry/Stop/Target.
  const headerWorker = await newWorker();
  const { data: headerData } = await headerWorker.recognize(await image.fullDataUrl());
  await headerWorker.terminate();
  // Склеиваем «79.000,0» / «79 000,0» обратно в «79000,0» — иначе разделитель
  // тысяч на глаз OCR путается то с точкой, то с пробелом, и якоря ниже видят
  // расходящееся число знаков после запятой там, где реально его нет.
  const fullText = joinThousandsSpaces(headerData.text);
  const header = parseHeader(fullText);
  const decimalAnchor = detectDecimalAnchor(fullText);
  const magnitudeRef = buildMagnitudeReference(fullText);

  const digitWorker = await newWorker();
  await digitWorker.setParameters({ tessedit_char_whitelist: DIGIT_WHITELIST, tessedit_pageseg_mode: '7' });

  const bands = findColorBands(image, profile);
  const candidatesByField = { entry: [], stop: [], target: [] };
  const debugBands = [];

  for (const band of bands) {
    const field = FIELD_BY_BUCKET[band.bucket];
    const inRange = band.heightPx >= profile.normalHeightMin && band.heightPx <= profile.normalHeightMax;
    if (!field || !inRange) continue; // не наш бакет, шум или многострочный «текущая цена»

    const { rawText, ocrConfidence, cropDataUrl } = await ocrBand(image, digitWorker, band);
    debugBands.push({ ...band, field, rawText, ocrConfidence });
    if (!rawText) continue;

    const { value, guessedSeparator, hadStrayChars, cleanText } = normalizePriceText(rawText, decimalAnchor.decimalDigits);
    if (value == null) continue;

    candidatesByField[field].push({
      value, rawText, ocrConfidence, guessedSeparator, hadStrayChars,
      digitCount: (cleanText.match(/\d/g) || []).length,
      heightPx: band.heightPx, yCenter: (band.y0 + band.y1) / 2, cropDataUrl,
    });
  }
  await digitWorker.terminate();

  // Entry обычно однозначнее (серый бакет реже встречается где-то ещё на
  // скриншоте случайно) — резолвим его первым, а Stop/Target при выборе
  // среди дублей-кандидатов дополнительно тянет к тому, что рядом по
  // вертикали с Entry: настоящие Entry/Stop/Target всегда стоят кучно, в
  // отличие от случайной одноцветной плашки в другом месте скриншота
  // (напр. отдельный «диапазон дня» вверху мобильного экрана).
  let entryC = pickBestCandidate(candidatesByField.entry, profile);
  let stopC = pickBestCandidate(candidatesByField.stop, profile, { nearY: entryC?.yCenter });
  let targetC = pickBestCandidate(candidatesByField.target, profile, { nearY: entryC?.yCenter });

  const sanity = crossFieldSanity(entryC?.value ?? null, stopC?.value ?? null, targetC?.value ?? null);
  [entryC, stopC, targetC] = [entryC, stopC, targetC].map((c) => applySanity(c, sanity));

  // Правдоподобие величины — независимая проверка «похоже ли число на цену
  // с этого скриншота», ловит именно тот класс ошибок, который OCR выдаёт
  // «чисто» (см. magnitude-anchor.js — разбор на реальном ETH-скриншоте,
  // где Tesseract уверенно прочитал не тот символ и в Entry, и в Target).
  entryC = applyFlag(entryC, checkMagnitude(entryC?.value, magnitudeRef));
  stopC = applyFlag(stopC, checkMagnitude(stopC?.value, magnitudeRef));
  targetC = applyFlag(targetC, checkMagnitude(targetC?.value, magnitudeRef));

  // Направление по геометрии (см. direction.js) — считаем один раз здесь,
  // чтобы дополнительно проверить, что Stop/Target лежат с той стороны от
  // Entry, которая соответствует Long/Short. Несоответствие может означать
  // ошибку и в цене, и в направлении — помечаем обе стороны, а не
  // подставляем «более вероятный» вариант.
  const directionValue = detectDirection(entryC?.yCenter, stopC?.yCenter);
  const levels = checkDirectionLevels(entryC?.value, stopC?.value, targetC?.value, directionValue);
  const directionNotes = [];
  if (!levels.stopOk) {
    stopC = applyFlag(stopC, `Stop расположен не с той стороны от Entry для направления «${directionValue}»`);
    directionNotes.push('Stop расположен не с той стороны от Entry для этого направления');
  }
  if (!levels.targetOk) {
    targetC = applyFlag(targetC, `Target расположен не с той стороны от Entry для направления «${directionValue}»`);
    directionNotes.push('Target расположен не с той стороны от Entry для этого направления');
  }

  [entryC, stopC, targetC] = [entryC, stopC, targetC].map((c) => capIfFormatUnsure(c, formatConfident));

  return {
    format: profile.name,
    formatConfident,
    formatScores: scores,
    entry: toField(entryC),
    stop: toField(stopC),
    target: toField(targetC),
    pair: pairField(header.pair),
    direction: directionField(entryC, stopC, directionNotes),
    timeframe: headerField(header.timeframe),
    crossFieldSanity: sanity,
    debug: { bandsFound: debugBands, decimalAnchor, magnitudeRef },
  };
}

function applyFlag(candidate, reason) {
  if (!candidate || !reason) return candidate;
  return { ...candidate, confidence: downgrade(candidate.confidence), notes: [...candidate.notes, reason] };
}

function applySanity(candidate, sanity) {
  if (!candidate || sanity.ok) return candidate;
  return { ...candidate, confidence: candidate.confidence === 'high' ? 'medium' : 'low', notes: [...candidate.notes, sanity.reason] };
}

function capIfFormatUnsure(candidate, formatConfident) {
  if (!candidate || formatConfident || candidate.confidence !== 'high') return candidate;
  return { ...candidate, confidence: 'medium', notes: [...candidate.notes, 'формат скриншота (desktop/mobile) определён неуверенно'] };
}

function toField(c) {
  if (!c) return null;
  return { value: c.value, raw: c.rawText, confidence: c.confidence, notes: c.notes, cropDataUrl: c.cropDataUrl };
}

function headerField(match) {
  if (!match) return null;
  return { value: match.value, raw: match.found, confidence: 'medium', notes: ['получено из текста всего скриншота, без перекрёстной проверки'] };
}

// Пара: parseHeader отдаёт только сырые base/quote — что с ними делать
// (приводить к BTCUSDT и т.п.) решает normalize-pair.js. Если инструмент не
// распознан этим слоем (пока поддержана только крипта) — поле остаётся
// пустым, а не показывает сырой неприведённый текст как есть.
function pairField(rawMatch) {
  if (!rawMatch) return null;
  const normalized = normalizePair(rawMatch);
  if (!normalized) return null;
  return {
    value: normalized.value,
    raw: rawMatch.found,
    confidence: 'medium',
    notes: [`получено из текста всего скриншота, без перекрёстной проверки; приведено к внутреннему формату из «${rawMatch.found}»`],
  };
}

const CONFIDENCE_RANK = { high: 2, medium: 1, low: 0 };
function weakerConfidence(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

// Направление — по геометрии уже найденных плашек Entry/Stop (см.
// direction.js), НЕ по тексту. Уверенность наследуется от более слабого из
// двух кандидатов: правильность направления зависит от того, что обе
// плашки распознаны верно.
function directionField(entryC, stopC, extraNotes = []) {
  const value = detectDirection(entryC?.yCenter, stopC?.yCenter);
  if (!value) return null;
  let confidence = weakerConfidence(entryC?.confidence, stopC?.confidence) ?? 'low';
  const notes = ['определено по взаимному расположению плашек Stop/Entry на экране, а не по тексту'];
  if (extraNotes.length) {
    confidence = downgrade(confidence);
    notes.push(...extraNotes);
  }
  return { value, raw: null, confidence, notes };
}
