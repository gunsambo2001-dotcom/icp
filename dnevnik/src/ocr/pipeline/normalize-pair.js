// Нормализация торговой пары — отдельный слой поверх сырого распознавания
// (parse-header.js только извлекает base/quote с экрана, ничего не решает
// про формат). Здесь и только здесь знание о том, что для крипты внутренний
// формат — COINUSDT, независимо от того, как биржа/TradingView подписала
// котировку на экране (BTC/USD, BTC/USDT, BTCUSD — всё приводится к
// BTCUSDT). ВАЖНО: это НЕ общее правило «USD → USDT» — оно жёстко привязано
// к криптоинструментам через normalizeCrypto ниже. Когда понадобится форекс
// (USD/RUB, EUR/USD и т.п.) или другой класс инструментов — добавляется
// свой normalizeXxx(base, quote) и вызов в normalizePair, без изменений в
// OCR/parse-header.js.

// TradingView в шапке иногда пишет полное название монеты вместо тикера
// (напр. «Bitcoin/USD» вместо «BTC/USD» — так на всех проверенных desktop
// скриншотах). Пополнять по мере появления новых пар в тестах.
const CRYPTO_NAME_ALIASES = {
  BITCOIN: 'BTC',
  ETHEREUM: 'ETH',
  SOLANA: 'SOL',
  INJECTIVE: 'INJ',
};

const CRYPTO_QUOTES = new Set(['USDT', 'USD', 'BUSD', 'USDC']);

function normalizeCrypto(base, quote) {
  if (!CRYPTO_QUOTES.has(quote)) return null;
  const ticker = CRYPTO_NAME_ALIASES[base] ?? base;
  return { value: `${ticker}USDT`, instrumentType: 'crypto' };
}

/**
 * @param {{base:string, quote:string}|null} raw — сырые base/quote из parse-header.js
 * @returns {{value:string, instrumentType:string}|null}
 */
export function normalizePair(raw) {
  if (!raw?.base || !raw?.quote) return null;
  const base = raw.base.toUpperCase();
  const quote = raw.quote.toUpperCase();

  return normalizeCrypto(base, quote);
  // будущие классы инструментов (форекс и т.д.) — свои normalizeXxx(base, quote) здесь
}
