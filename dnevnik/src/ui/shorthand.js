// Разбор строки быстрого ввода сделки, напр.:
//   "BTCUSDT short 79230 sl 79485 tp 78465 risk 1% x10"
//   "ETH long entry 3200 stop 3150 target 3400 size 1.5"
// Толерантный: понимает синонимы и разный порядок. Возвращает черновик —
// пользователь всё равно проверяет форму перед сохранением.

const QUOTE = ['USDT', 'USD', 'USDC', 'PERP', 'BUSD'];

/**
 * @param {string} input
 * @returns {{ ok: boolean, data?: object, warnings: string[], error?: string }}
 */
export function parseShorthand(input) {
  const warnings = [];
  const raw = String(input || '').trim();
  if (!raw) return { ok: false, warnings, error: 'Пустая строка' };

  const tokens = raw.split(/\s+/);
  const lower = raw.toLowerCase();
  const data = {};

  // --- символ: первый токен, похожий на тикер ---
  const symTok = tokens.find((t) => /^[a-z]{2,12}(usdt|usd|usdc|perp|busd)?\.?p?$/i.test(t) && !isKeyword(t));
  if (symTok) {
    let s = symTok.toUpperCase().replace(/\.P$/i, '').replace(/\.$/,'');
    if (!QUOTE.some((q) => s.endsWith(q))) {
      s += 'USDT';
      warnings.push(`Пара дополнена до ${s}`);
    }
    data.symbol = s;
  } else {
    warnings.push('Пара не распознана');
  }

  // --- направление ---
  if (/\b(long|buy|лонг|покупка)\b/i.test(lower)) data.direction = 'long';
  else if (/\b(short|sell|шорт|продажа)\b/i.test(lower)) data.direction = 'short';
  else warnings.push('Направление не распознано');

  // --- плечо: x10 / 10x / lev 10 / leverage 10 / плечо 10 ---
  const lev =
    matchNum(lower, /(?:x|х)\s*(\d{1,3})(?!\d)/) ??
    matchNum(lower, /(\d{1,3})\s*(?:x|х)\b/) ??
    matchNum(lower, /(?:lev|leverage|плечо)\s*[:=]?\s*(\d{1,3})/);
  if (lev != null) data.leverage = lev;

  // --- риск: N% или risk N ---
  const riskPct =
    matchNum(lower, /(?:risk|риск)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%?/) ??
    matchNum(lower, /(\d+(?:[.,]\d+)?)\s*%/);
  if (riskPct != null) data.riskPct = riskPct;

  // --- размер позиции ---
  const size = matchNum(lower, /(?:size|qty|объ[её]м|размер)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/);
  if (size != null) data.size = size;

  // --- уровни: entry / sl / tp по ключевым словам ---
  data.entry ??= labelledNum(lower, ['entry', 'вход', '@']);
  data.stop = labelledNum(lower, ['sl', 'stop', 'stoploss', 'стоп']);
  data.target = labelledNum(lower, ['tp', 'take', 'target', 'тейк', 'тп']);

  // --- добор недостающих уровней позиционно ---
  // берём числа, которые не являются плечом/риском/размером/процентом
  const consumed = new Set([data.entry, data.stop, data.target, data.leverage, data.riskPct, data.size].filter((x) => x != null));
  const bareNums = [...lower.matchAll(/(?<![a-zа-я\d.])(\d{1,9}(?:[.,]\d+)?)(?!\s*%)(?!\s*(?:x|х)\b)/gi)]
    .map((m) => toNum(m[1]))
    .filter((n) => !consumed.has(n));

  if (data.entry == null && bareNums.length) { data.entry = bareNums.shift(); }
  if (data.stop == null && bareNums.length) { data.stop = bareNums.shift(); warnings.push('Стоп определён по позиции — проверьте'); }
  if (data.target == null && bareNums.length) { data.target = bareNums.shift(); warnings.push('Тейк определён по позиции — проверьте'); }

  // --- если направление не задано, попробуем вывести из геометрии ---
  if (!data.direction && data.entry != null && data.stop != null) {
    data.direction = data.stop < data.entry ? 'long' : 'short';
    warnings.push(`Направление выведено из уровней: ${data.direction === 'long' ? 'LONG' : 'SHORT'} — проверьте`);
  }

  // --- проверки согласованности ---
  const issues = validateGeometry(data);
  warnings.push(...issues);

  const hasCore = data.symbol && data.direction && data.entry != null && data.stop != null;
  if (!hasCore) {
    return { ok: false, warnings, error: 'Не хватает: ' + missingList(data).join(', ') };
  }
  return { ok: true, data, warnings };
}

function isKeyword(t) {
  return /^(long|short|buy|sell|entry|sl|tp|stop|take|target|risk|size|qty|lev|leverage|x\d+)$/i.test(t);
}
function toNum(s) {
  return parseFloat(String(s).replace(',', '.'));
}
function matchNum(str, re) {
  const m = str.match(re);
  return m ? toNum(m[1]) : null;
}
function labelledNum(str, labels) {
  for (const l of labels) {
    const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = str.match(new RegExp(`${esc}\\s*[:=]?\\s*(\\d+(?:[.,]\\d+)?)`, 'i'));
    if (m) return toNum(m[1]);
  }
  return null;
}
function validateGeometry(d) {
  const out = [];
  if (d.entry != null && d.stop != null && d.direction) {
    if (d.direction === 'long' && d.stop >= d.entry) out.push('Для LONG стоп должен быть ниже входа');
    if (d.direction === 'short' && d.stop <= d.entry) out.push('Для SHORT стоп должен быть выше входа');
  }
  if (d.entry != null && d.target != null && d.direction) {
    if (d.direction === 'long' && d.target <= d.entry) out.push('Для LONG тейк должен быть выше входа');
    if (d.direction === 'short' && d.target >= d.entry) out.push('Для SHORT тейк должен быть ниже входа');
  }
  return out;
}
function missingList(d) {
  const m = [];
  if (!d.symbol) m.push('пара');
  if (!d.direction) m.push('направление');
  if (d.entry == null) m.push('вход');
  if (d.stop == null) m.push('стоп');
  return m;
}
