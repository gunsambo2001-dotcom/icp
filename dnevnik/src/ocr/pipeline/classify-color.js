// Оттенок → «бакет» цвета. Универсально для всех профилей (desktop/mobile) —
// цвет плашки означает одно и то же независимо от устройства/разрешения:
// red = риск (Stop), green/teal = вознаграждение (Target), gray = нейтральная
// (Entry). Подтверждено на реальных скриншотах (BTC/ETH/SOL/PEPE,
// LONG и SHORT) — см. ocr-test/samples. Индикатор текущей цены TradingView
// НЕ имеет фиксированного цвета (красный/зелёный/бирюзовый в зависимости от
// движения рынка) — от него отделяемся высотой плашки (см. color-bands.js),
// не цветом.
export function classifyColor(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
  if (chroma < 40) return 'gray';
  if (r - Math.max(g, b) > 25) return 'red';
  // teal/cyan: и G, и B заметно выше R, и близки друг к другу (в отличие от
  // чистого зелёного, где B остаётся низким, как у красного)
  if (g - r > 30 && b - r > 30 && Math.abs(g - b) < 40) return 'teal';
  if (g - Math.max(r, b) > 25) return 'green';
  if (b - Math.max(r, g) > 25) return 'blue';
  return 'other';
}

/** Бакет цвета → какое поле сделки он обозначает. Не входят в карту — игнорируются. */
export const FIELD_BY_BUCKET = { red: 'stop', green: 'target', teal: 'target', gray: 'entry' };
