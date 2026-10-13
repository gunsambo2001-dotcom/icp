// Демо-данные для прототипа (Этап 1). Загружаются в пустой LocalStore,
// чтобы дашборд/аналитика были не пустыми при первом открытии.
// Реальные данные ученика их вытеснят.

import { LOCAL_USER_ID, LOCAL_ACCOUNT_ID } from '../model/enums.js';

const U = LOCAL_USER_ID;
const A = LOCAL_ACCOUNT_ID;

/** @type {Partial<import('../model/types.js').Strategy>[]} */
export const SEED_STRATEGIES = [
  { id: 'st-breakout', userId: U, name: 'Пробой уровня', moduleRef: 'Модуль 3' },
  { id: 'st-retest', userId: U, name: 'Ретест', moduleRef: 'Модуль 3' },
  { id: 'st-trend', userId: U, name: 'Тренд-континуация', moduleRef: 'Модуль 4' },
  { id: 'st-fakeout', userId: U, name: 'Ложный пробой', moduleRef: 'Модуль 5' },
];

// o: { entry, stop, size, dir, ... , exits:[{kind,price,size,at}] }  — либо legacy exit
function trade(o) {
  const t = {
    userId: U,
    accountId: A,
    marketType: 'futures',
    leverage: 10,
    source: 'manual',
    screenshotUrls: [],
    tags: [],
    mistakes: [],
    exits: [],
    entry: o.entry,
    initialStop: o.stop,
    plannedEntry: o.entry,
    plannedStop: o.stop,
    plannedTarget: o.tp3 ?? o.target,
    tp1: o.tp1,
    tp2: o.tp2,
    tp3: o.tp3 ?? o.target,
    createdAt: o.openedAt,
    updatedAt: o.closedAt || o.openedAt,
    ...o,
  };
  // legacy exit → одна запись в exits
  if ((!t.exits || !t.exits.length) && o.exit != null) {
    t.exits = [{ kind: 'manual', price: o.exit, size: o.size, at: o.closedAt }];
  }
  const closed = (t.exits || []).reduce((s, e) => s + e.size, 0);
  t.status = t.size > 0 && closed >= t.size * (1 - 1e-6) ? 'closed' : 'open';
  return t;
}

/** @type {Partial<import('../model/types.js').Trade>[]} */
export const SEED_TRADES = [
  trade({ id: 's1', symbol: 'BTCUSDT', direction: 'long', strategyId: 'st-breakout', strategyName: 'Пробой уровня', session: 'london', timeframe: '1h',
    openedAt: '2026-08-14T11:10:00Z', closedAt: '2026-08-14T15:30:00Z',
    entry: 62400, stop: 61700, tp3: 64500, exit: 64500, size: 0.145, feesPaid: 9 }),
  trade({ id: 's2', symbol: 'ETHUSDT', direction: 'short', strategyId: 'st-retest', strategyName: 'Ретест', session: 'newyork', timeframe: '1h',
    openedAt: '2026-08-15T15:40:00Z', closedAt: '2026-08-15T18:05:00Z',
    entry: 3820, stop: 3870, tp3: 3700, exit: 3745, size: 2.0, feesPaid: 4 }),
  trade({ id: 's3', symbol: 'SOLUSDT', direction: 'long', strategyId: 'st-trend', strategyName: 'Тренд-континуация', session: 'asia', timeframe: '15m',
    openedAt: '2026-08-17T04:20:00Z', closedAt: '2026-08-17T06:00:00Z',
    entry: 178, stop: 172, tp3: 192, exit: 172, size: 17, feesPaid: 3 }),
  trade({ id: 's4', symbol: 'BTCUSDT', direction: 'short', strategyId: 'st-fakeout', strategyName: 'Ложный пробой', session: 'london', timeframe: '1h',
    openedAt: '2026-08-19T09:50:00Z', closedAt: '2026-08-19T13:20:00Z',
    entry: 69800, stop: 70500, tp3: 68000, exit: 68300, size: 0.145, feesPaid: 9 }),

  // --- сделка с частичными фиксациями: TP1 40%, TP2 30%, остаток по TP3 ---
  trade({ id: 's5', symbol: 'BTCUSDT', direction: 'long', strategyId: 'st-retest', strategyName: 'Ретест', session: 'london', timeframe: '1h',
    openedAt: '2026-08-25T11:45:00Z', closedAt: '2026-08-25T18:30:00Z',
    entry: 65800, stop: 65100, tp1: 66500, tp2: 67100, tp3: 67600,
    tp1Pct: 40, tp2Pct: 30, breakevenAfterTp1: true, beBuffer: 0,
    size: 0.15, feesPaid: 11,
    exits: [
      { kind: 'tp1', price: 66500, size: 0.06, at: '2026-08-25T13:10:00Z' },
      { kind: 'tp2', price: 67100, size: 0.045, at: '2026-08-25T15:40:00Z' },
      { kind: 'tp3', price: 67600, size: 0.045, at: '2026-08-25T18:30:00Z' },
    ] }),

  // --- сделка, где после TP1 остаток вышел в безубыток (стоп в БУ спас) ---
  trade({ id: 's6', symbol: 'ETHUSDT', direction: 'long', strategyId: 'st-trend', strategyName: 'Тренд-континуация', session: 'newyork', timeframe: '1h',
    openedAt: '2026-08-27T15:55:00Z', closedAt: '2026-08-27T20:20:00Z',
    entry: 3120, stop: 3060, tp1: 3180, tp2: 3260, tp3: 3320,
    tp1Pct: 40, tp2Pct: 30, breakevenAfterTp1: true, beBuffer: 2,
    size: 1.7, feesPaid: 6,
    exits: [
      { kind: 'tp1', price: 3180, size: 0.68, at: '2026-08-27T17:30:00Z' },
      { kind: 'be', price: 3122, size: 1.02, at: '2026-08-27T20:20:00Z' },
    ] }),

  trade({ id: 's7', symbol: 'BTCUSDT', direction: 'short', strategyId: 'st-fakeout', strategyName: 'Ложный пробой', session: 'london', timeframe: '1h',
    openedAt: '2026-09-02T09:40:00Z', closedAt: '2026-09-02T14:15:00Z',
    entry: 66200, stop: 66900, tp3: 64000, exit: 65100, size: 0.145, feesPaid: 9 }),

  // --- открытая позиция ---
  trade({ id: 's8', symbol: 'BTCUSDT', direction: 'short', strategyId: 'st-fakeout', strategyName: 'Ложный пробой', session: 'london', timeframe: '1h',
    openedAt: '2026-09-08T10:05:00Z',
    entry: 79230, stop: 79485, tp1: 78900, tp2: 78650, tp3: 78465,
    tp1Pct: 40, tp2Pct: 30, breakevenAfterTp1: true,
    currentPrice: 78505, size: 0.4 }),
];

export const SEED_CASHFLOWS = [
  { id: 'cf1', accountId: A, type: 'deposit', amount: 10000, date: '2026-07-20T00:00:00Z', note: 'Стартовый депозит' },
];

export const SEED_JOURNAL = [
  {
    id: 'j1', userId: U, type: 'weekly', title: 'Обзор недели 24 авг – 30 авг',
    weekOf: '2026-08-24T00:00:00Z',
    body: [
      'Обзор недели 24 авг – 30 авг',
      '',
      'Статистика: 4 сделки · винрейт 75% · P&L +$470 · +5.2R',
      '',
      'Что получилось:',
      '- Терпеливо дождался ретеста на BTC, не входил на импульсе.',
      '- Частичная фиксация на TP1 и перевод в БУ — один раз спасла от убытка.',
      '',
      'Ошибки и нарушения правил:',
      '- В четверг закрыл SOL раньше TP2 из-за нетерпения.',
      '',
      'План на следующую неделю:',
      '- Не трогать остаток позиции после перевода в БУ до TP2/TP3.',
    ].join('\n'),
    createdAt: '2026-08-30T18:00:00Z', updatedAt: '2026-08-30T18:00:00Z',
  },
];

/** Залить демо-данные в пустой store. */
export async function seedStore(store) {
  const existing = await store.listTrades();
  if (existing.length > 0) return false;
  await store.updateSettings({ startingBalance: 10000 });
  for (const s of SEED_STRATEGIES) await store.createStrategy(s);
  for (const t of SEED_TRADES) await store.createTrade(t);
  for (const e of SEED_JOURNAL) await store.createJournalEntry(e);
  return true;
}
