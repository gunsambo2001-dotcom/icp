// Перечисления домена. Строковые значения — чтобы напрямую ложились в Supabase
// (enum-колонки или text) и в JSON LocalStorage без преобразования.

export const Direction = Object.freeze({
  LONG: 'long',
  SHORT: 'short',
});

export const MarketType = Object.freeze({
  FUTURES: 'futures',
  SPOT: 'spot',
});

export const TradeStatus = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
});

// Откуда пришли данные сделки — под будущий OCR / импорт.
export const TradeSource = Object.freeze({
  MANUAL: 'manual',
  SHORTHAND: 'shorthand',   // строка вида "BTCUSDT short 79230 sl 79485 tp 78465"
  SCREENSHOT: 'screenshot', // распознавание скриншота TradingView
  IMPORT: 'import',         // CSV / API биржи
});

// Уверенность распознавания отдельного поля (для пометок 🟢/🟡/🔴 в форме).
export const FieldConfidence = Object.freeze({
  HIGH: 'high',     // 🟢 подставлено уверенно
  MEDIUM: 'medium', // 🟡 проверь
  LOW: 'low',       // 🔴 введи вручную
});

export const Session = Object.freeze({
  ASIA: 'asia',
  LONDON: 'london',
  NEWYORK: 'newyork',
});

export const CashflowType = Object.freeze({
  DEPOSIT: 'deposit',
  WITHDRAWAL: 'withdrawal',
});

export const UserRole = Object.freeze({
  STUDENT: 'student',
  MENTOR: 'mentor',
  ADMIN: 'admin',
});

// Значения id для одиночного режима Этапа 1. На Этапе 2 заменяются реальными
// id из Supabase auth — код, который их использует, не меняется.
export const LOCAL_USER_ID = 'local-user';
export const LOCAL_ACCOUNT_ID = 'local-account';
