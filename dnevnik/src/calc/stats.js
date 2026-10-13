// ── Агрегатная статистика по дневнику ────────────────────────────────────────
// Чистая функция: на вход — список сделок + параметры счёта, на выход — все
// показатели. Ничего не хранит: статистика всегда пересчитывается из сырых сделок.

import { computeTradeResult } from './trade.js';

/** Группировка списка по значению поля/функции. @returns {Record<string, any[]>} */
export function groupBy(items, keyOrFn) {
  const fn = typeof keyOrFn === 'function' ? keyOrFn : (x) => x[keyOrFn];
  const out = {};
  for (const it of items) {
    const k = fn(it) ?? '—';
    (out[k] ||= []).push(it);
  }
  return out;
}

/** Текущие цены открытых сделок по символам — для нереализованного P&L в computeStats. */
export function openTradePrices(trades) {
  const prices = {};
  for (const t of trades) {
    if ((t.status === 'open' || t.exit == null) && t.currentPrice) prices[t.symbol] = t.currentPrice;
  }
  return prices;
}

function sum(arr, fn = (x) => x) {
  return arr.reduce((s, x) => s + fn(x), 0);
}
function avg(arr, fn = (x) => x) {
  return arr.length ? sum(arr, fn) / arr.length : 0;
}
function dayKey(iso) {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Статистика по группе результатов (используется и для срезов, и для long/short).
 * @param {Array} results — элементы computeTradeResult (только закрытые)
 */
function groupStats(results) {
  const wins = results.filter((r) => r.pnl > 0);
  const losses = results.filter((r) => r.pnl < 0);
  const grossWin = sum(wins, (r) => r.pnl);
  const grossLoss = Math.abs(sum(losses, (r) => r.pnl));
  return {
    count: results.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: results.filter((r) => r.pnl === 0).length,
    netPnl: sum(results, (r) => r.pnl),
    netR: sum(results, (r) => r.rMultiple),
    grossWin,
    grossLoss,
    winRate: results.length ? wins.length / results.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    avgWinR: avg(wins, (r) => r.rMultiple),
    avgLossR: Math.abs(avg(losses, (r) => r.rMultiple)),
    avgR: avg(results, (r) => r.rMultiple),
    payoffRatio: losses.length && wins.length ? grossWin / wins.length / (grossLoss / losses.length) : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    expectancyR: results.length ? sum(results, (r) => r.rMultiple) / results.length : 0,
    expectancyUsd: results.length ? sum(results, (r) => r.pnl) / results.length : 0,
  };
}

/** Макс. серии побед/убытков и текущая серия (знак = направление). */
function streaks(resultsChrono) {
  let cur = 0;
  let curSign = 0;
  let maxWin = 0;
  let maxLoss = 0;
  for (const r of resultsChrono) {
    if (r.pnl === 0) continue;
    const s = r.pnl > 0 ? 1 : -1;
    if (s === curSign) cur += 1;
    else {
      cur = 1;
      curSign = s;
    }
    if (s === 1) maxWin = Math.max(maxWin, cur);
    else maxLoss = Math.max(maxLoss, cur);
  }
  return { maxWinStreak: maxWin, maxLossStreak: maxLoss, currentStreak: curSign * cur };
}

/**
 * Кривая капитала и просадка. События (вводы/выводы + закрытые сделки) по дате.
 * @returns {{ curve: Array<{date:string,equity:number}>, maxDrawdown:number, maxDrawdownPct:number, equityNow:number }}
 */
function equityAndDrawdown({ startingBalance, cashflows, closedResultsWithDate }) {
  const events = [];
  for (const cf of cashflows || []) {
    events.push({ date: cf.date, delta: cf.type === 'withdrawal' ? -cf.amount : cf.amount, isCashflow: true });
  }
  for (const r of closedResultsWithDate) {
    events.push({ date: r.date, delta: r.pnl, isCashflow: false });
  }
  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  let equity = startingBalance;
  let peak = startingBalance;
  let maxDD = 0;
  let maxDDpct = 0;
  const curve = [{ date: events[0]?.date ?? null, equity }];
  for (const e of events) {
    equity += e.delta;
    if (e.isCashflow) {
      // ввод/вывод сдвигает и баланс, и «ватерлинию» — это не просадка от торговли
      peak = Math.max(peak + e.delta, equity);
    } else {
      peak = Math.max(peak, equity);
      const dd = peak - equity;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDpct = peak > 0 ? dd / peak : 0;
      }
    }
    curve.push({ date: e.date, equity });
  }
  return { curve, maxDrawdown: maxDD, maxDrawdownPct: maxDDpct, equityNow: equity };
}

/**
 * Главная функция статистики дневника.
 * @param {import('../model/types.js').Trade[]} trades
 * @param {Object} opts
 * @param {number} opts.startingBalance
 * @param {import('../model/types.js').Cashflow[]} [opts.cashflows]
 * @param {Record<string, number>} [opts.prices]  — текущие цены для открытых сделок
 * @returns {Object}
 */
export function computeStats(trades, opts) {
  const { startingBalance, cashflows = [], prices = {} } = opts;

  const enriched = trades.map((t) => {
    const res = computeTradeResult(t, { prices });
    return { trade: t, res, when: res.closedAt || t.closedAt || t.openedAt };
  });
  enriched.sort((a, b) => new Date(a.when) - new Date(b.when));

  const closed = enriched.filter((e) => !e.res.isOpen);
  const open = enriched.filter((e) => e.res.isOpen);
  const closedResults = closed.map((e) => e.res);

  const base = groupStats(closedResults);
  const strk = streaks(closedResults);

  const closedWithDate = closed.map((e) => ({ pnl: e.res.pnl, date: e.when }));
  const eq = equityAndDrawdown({
    startingBalance,
    cashflows,
    closedResultsWithDate: closedWithDate,
  });

  // P&L по дням
  const daily = Object.entries(
    closedWithDate.reduce((m, r) => {
      const k = dayKey(r.date);
      m[k] = (m[k] || 0) + r.pnl;
      return m;
    }, {}),
  )
    .map(([date, pnl]) => ({ date, pnl }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Срезы
  const sliceBy = (keyFn) => {
    const groups = groupBy(closed, (e) => keyFn(e.trade, e.when));
    const out = {};
    for (const [k, arr] of Object.entries(groups)) {
      out[k] = groupStats(arr.map((e) => e.res));
    }
    return out;
  };

  const extremes = closedResults.length
    ? {
        bestTrade: closedResults.reduce((a, b) => (b.pnl > a.pnl ? b : a)),
        worstTrade: closedResults.reduce((a, b) => (b.pnl < a.pnl ? b : a)),
        bestR: Math.max(...closedResults.map((r) => r.rMultiple)),
        worstR: Math.min(...closedResults.map((r) => r.rMultiple)),
      }
    : { bestTrade: null, worstTrade: null, bestR: 0, worstR: 0 };

  return {
    ...base,
    ...strk,
    ...extremes,

    totalTrades: trades.length,
    closedCount: closed.length,
    openCount: open.length,

    startingBalance,
    equityNow: eq.equityNow,
    netDepositWithdrawal: sum(cashflows, (c) => (c.type === 'withdrawal' ? -c.amount : c.amount)),
    maxDrawdown: eq.maxDrawdown,
    maxDrawdownPct: eq.maxDrawdownPct,
    equityCurve: eq.curve,
    dailyPnl: daily,

    unrealizedPnl: sum(open, (e) => e.res.pnl),
    openPositions: open.map((e) => ({ trade: e.trade, ...e.res })),

    long: groupStats(closed.filter((e) => e.trade.direction === 'long').map((e) => e.res)),
    short: groupStats(closed.filter((e) => e.trade.direction === 'short').map((e) => e.res)),

    bySymbol: sliceBy((t) => t.symbol),
    byStrategy: sliceBy((t) => t.strategyName || t.strategyId || '—'),
    bySession: sliceBy((t) => t.session || '—'),
    byWeekday: sliceBy((t, when) => new Date(when).getUTCDay()),
    byDirection: sliceBy((t) => t.direction),

    // методология: частичные фиксации и перевод в безубыток
    withPartials: closed.filter((e) => e.res.exits.length > 1).length,
    withBreakeven: closed.filter((e) => e.res.movedToBreakeven).length,
    breakevenExits: closed.filter((e) => e.res.movedToBreakeven && e.res.isBreakeven).length,

    tradeResults: closedResults,
  };
}
