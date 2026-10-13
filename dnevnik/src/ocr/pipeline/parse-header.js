// Пара / таймфрейм — из текста, который OCR видит на всей картинке целиком
// (не из вырезанных плашек). Профиль-независимо: эти подписи на desktop и
// mobile выглядят одинаково текстово, разница только в раскладке экрана.
//
// Направление (Long/Short) здесь СОЗНАТЕЛЬНО не ищется: слово LONG/SHORT
// физически не печатается инструментом риск/прибыль TradingView ни на
// одном из проверенных скриншотов — искать его текстом бессмысленно.
// Направление определяется по геометрии плашек, см. direction.js.
//
// Эта функция отдаёт только СЫРЫЕ base/quote, как они видны на экране
// («Bitcoin/USD», «BTCUSDT», «INJ/USD» — как получится). Что с этим делать
// (приводить к BTCUSDT и т.п.) решает отдельный слой — normalize-pair.js.
const PAIR_PATTERN = /\b([A-Z0-9]{2,15})\/?(USDT|USD|BUSD|USDC|BTC|ETH)\b/;

export function parseHeader(fullText) {
  const upper = fullText.toUpperCase();
  const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);

  const pairMatch = upper.match(PAIR_PATTERN);
  const tfMatch = fullText.match(/\b(\d{1,3})\s?(m|min|h|hr|hour|d|day|w|week)\b/i);

  return {
    pair: pairMatch ? { base: pairMatch[1], quote: pairMatch[2], found: pairMatch[0] } : null,
    timeframe: tfMatch ? { value: tfMatch[0], found: tfMatch[0] } : null,
    lines, // на случай будущей более точной разметки
  };
}
