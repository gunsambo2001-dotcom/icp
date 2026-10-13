// ── Контракт хранилища ───────────────────────────────────────────────────────
// Один и тот же интерфейс для LocalStore (Этап 1) и SupabaseStore (Этап 2).
// Все методы асинхронные (Promise), даже в LocalStore — чтобы при переходе на
// Supabase не менять вызывающий код.
//
// Изоляция данных: методы работают в контексте текущего пользователя/счёта.
// На Этапе 1 это LOCAL_USER_ID / LOCAL_ACCOUNT_ID. На Этапе 2 контекст задаёт
// Supabase auth + Row Level Security — сигнатуры методов не меняются.
//
// @typedef {Object} JournalStore
// @property {() => Promise<import('../model/types.js').Settings>} getSettings
// @property {(patch: Partial<import('../model/types.js').Settings>) => Promise<Settings>} updateSettings
//
// @property {() => Promise<{id: string, displayName: string}|null>} getMyMentor  — null, если наставника нет
// @property {(tradeId: string) => Promise<Array<{id: string, mentorId: string, comment: string, createdAt: string, updatedAt: string}>>} listTradeComments
//   — комментарии наставника к МОЕЙ сделке (только чтение; писать может лишь наставник через MentorStore)
//
// @property {() => Promise<import('../model/types.js').Account[]>} listAccounts
// @property {(data: Partial<Account>) => Promise<Account>} createAccount
// @property {(id: string) => Promise<void>} deleteAccount  — вместе со счётом удаляются его сделки и движения средств
//
// @property {() => Promise<import('../model/types.js').Trade[]>} listTrades
// @property {(id: string) => Promise<Trade|null>} getTrade
// @property {(data: Partial<Trade>) => Promise<Trade>} createTrade
// @property {(id: string, patch: Partial<Trade>) => Promise<Trade>} updateTrade
// @property {(id: string) => Promise<void>} deleteTrade
//
// @property {() => Promise<import('../model/types.js').Cashflow[]>} listCashflows
// @property {(data: Partial<Cashflow>) => Promise<Cashflow>} createCashflow
// @property {(id: string) => Promise<void>} deleteCashflow
//
// @property {() => Promise<import('../model/types.js').Strategy[]>} listStrategies
// @property {(data: Partial<Strategy>) => Promise<Strategy>} createStrategy
// @property {(id: string, patch: Partial<Strategy>) => Promise<Strategy>} updateStrategy
//
// @property {() => Promise<import('../model/types.js').JournalEntry[]>} listJournalEntries
// @property {(data: Partial<JournalEntry>) => Promise<JournalEntry>} createJournalEntry
// @property {(id: string, patch: Partial<JournalEntry>) => Promise<JournalEntry>} updateJournalEntry
// @property {(id: string) => Promise<void>} deleteJournalEntry
//
// @property {() => Promise<void>} clearAll        — только для разработки/тестов
// @property {(dump: object) => Promise<void>} importDump
// @property {() => Promise<object>} exportDump

/** Значения по умолчанию для настроек нового пользователя. */
export const DEFAULT_SETTINGS = Object.freeze({
  startingBalance: 10000,
  baseCurrency: 'USDT',
  timezone: 'Asia/Irkutsk',
  displayName: '',
  defaultRiskPct: 1,
  defaultLeverage: 10,
  commissionRatePct: 0.05,
  defaultSlippagePct: 0.02,
  fundingRatePct: 0.01,
  tp1ClosePct: 40,
  tp2ClosePct: 30,
  beBuffer: 0,
  breakevenAfterTp1: true,
});

/** Генератор id. crypto.randomUUID есть и в Node 18+, и в браузерах. */
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Проверка, что объект реализует контракт (используется в тестах). */
export const STORE_METHODS = [
  'getSettings', 'updateSettings', 'getMyMentor', 'listTradeComments',
  'listAccounts', 'createAccount', 'deleteAccount',
  'listTrades', 'getTrade', 'createTrade', 'updateTrade', 'deleteTrade',
  'listCashflows', 'createCashflow', 'deleteCashflow',
  'listStrategies', 'createStrategy', 'updateStrategy',
  'listJournalEntries', 'createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry',
  'clearAll', 'importDump', 'exportDump',
];

/**
 * Статус сделки по факту закрытий: закрыта, если закрытый объём ≈ полному,
 * либо задан legacy-exit, либо помечена явно. Общая для всех реализаций
 * store (LocalStore и SupabaseStore), чтобы статус не расходился между ними.
 */
export function deriveStatus(t) {
  const closedSize = (t.exits || []).reduce((s, e) => s + (e.size || 0), 0);
  const fullyClosed = (t.size > 0 && closedSize >= t.size * (1 - 1e-6)) || (t.exit != null && t.exit > 0);
  if (fullyClosed) return 'closed';
  if (t.status === 'closed') return 'closed'; // явно помечена (напр. стоп без записи в exits)
  return 'open';
}
