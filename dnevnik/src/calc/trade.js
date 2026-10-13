// ── Результат отдельной сделки ───────────────────────────────────────────────
// Поддерживает частичные фиксации (TP1/TP2/TP3) и перевод стопа в безубыток.
//
// Правила методологии курса:
//   • На TP1 закрывается часть позиции (процент настраивается), стоп остатка
//     переносится в безубыток (по умолчанию ровно на цену входа).
//   • На TP2 закрывается ещё часть, остаток идёт до TP3 (полное закрытие).
//   • R-МУЛЬТИПЛИКАТОР всегда считается от ПЕРВОНАЧАЛЬНОГО полного риска сделки
//     (цена входа ↔ первоначальный стоп × полный размер). После TP1/TP2 не
//     пересчитывается: 1R зафиксирован в момент входа.
//
// Общие с position.js помощники переиспользуются — математика едина.

import { riskReward } from './position.js';

const EPS = 1e-9;

/** Приводит сделку к списку выходов. Понимает и новый формат (exits[]), и legacy (exit). */
export function normalizeExits(trade) {
  if (Array.isArray(trade.exits) && trade.exits.length) {
    return trade.exits
      .filter((e) => e && e.price > 0 && e.size > 0)
      .map((e) => ({ kind: e.kind || 'manual', price: e.price, size: e.size, at: e.at || trade.closedAt || null }));
  }
  if (trade.exit != null && trade.exit > 0) {
    return [{ kind: 'manual', price: trade.exit, size: trade.size, at: trade.closedAt || null }];
  }
  return [];
}

/** Первоначальный стоп — база риска и R. Не «рабочий» (тот мог уйти в БУ). */
export function initialStopOf(trade) {
  return trade.initialStop ?? trade.plannedStop ?? trade.stop;
}

/** Первоначальный риск сделки, $: |вход − первоначальный стоп| × полный размер. */
export function initialRisk(trade) {
  const stop = initialStopOf(trade);
  return Math.abs(trade.entry - stop) * trade.size;
}

/**
 * Валовый PnL по одному выходу, $.
 * long:  (exit − entry) × size ;  short: (entry − exit) × size
 */
export function legPnl({ direction, entry, price, size }) {
  const dir = direction === 'short' ? -1 : 1;
  return (price - entry) * size * dir;
}

/** Совместимость: валовый PnL при полном закрытии по одной цене. */
export function grossPnl({ direction, entry, exit, size }) {
  return legPnl({ direction, entry, price: exit, size });
}

export function rMultiple({ netPnl, risk }) {
  if (!risk) return 0;
  return netPnl / risk;
}

/** Время в позиции, часы: от входа до последнего выхода. null если позиция открыта. */
export function holdingHours(trade) {
  const exits = normalizeExits(trade);
  const last = exits.map((e) => e.at).filter(Boolean).sort().at(-1) || trade.closedAt;
  if (!trade.openedAt || !last) return null;
  return (new Date(last) - new Date(trade.openedAt)) / 3.6e6;
}

/** Проскальзывание входа, % (факт vs план). */
export function entrySlippagePct({ entry, plannedEntry }) {
  if (plannedEntry == null || !(plannedEntry > 0)) return null;
  return ((entry - plannedEntry) / plannedEntry) * 100;
}

/**
 * Плановый «смешанный» R: сколько принесёт сетап, если отработают все цели
 * с указанными процентами фиксации. Помогает оценивать качество входа.
 * @returns {number|null}
 */
export function blendedPlannedR(trade) {
  const entry = trade.entry ?? trade.plannedEntry;
  const stop = initialStopOf(trade);
  const size = trade.size;
  if (!(entry > 0) || !(stop > 0) || !(size > 0)) return null;
  const risk = Math.abs(entry - stop) * size;
  if (!risk) return null;

  const p1 = frac(trade.tp1Pct);
  const p2 = frac(trade.tp2Pct);
  const legs = [];
  if (trade.tp1 > 0 && p1 > 0) legs.push([trade.tp1, size * p1]);
  if (trade.tp2 > 0 && p2 > 0) legs.push([trade.tp2, size * p2]);
  const rest = size * Math.max(0, 1 - p1 - p2);
  const finalTarget = trade.tp3 ?? trade.plannedTarget ?? trade.target;
  if (finalTarget > 0 && rest > EPS) legs.push([finalTarget, rest]);
  if (!legs.length) return null;

  const dir = trade.direction === 'short' ? -1 : 1;
  const total = legs.reduce((s, [price, sz]) => s + (price - entry) * sz * dir, 0);
  return total / risk;
}

/**
 * «Защищённый» R: TP1 отработал, остаток вышел в безубытке (вход + буфер).
 * Это гарантированный минимум сделки после переноса стопа в БУ.
 * @returns {number|null}
 */
export function protectedR(trade) {
  const entry = trade.entry ?? trade.plannedEntry;
  const stop = initialStopOf(trade);
  const size = trade.size;
  if (!(entry > 0) || !(stop > 0) || !(size > 0) || !(trade.tp1 > 0)) return null;
  const risk = Math.abs(entry - stop) * size;
  if (!risk) return null;
  const p1 = frac(trade.tp1Pct);
  if (!(p1 > 0)) return null;
  const dir = trade.direction === 'short' ? -1 : 1;
  const buffer = trade.beBuffer || 0;
  const bePrice = entry + (dir === 1 ? buffer : -buffer);
  const legTp1 = (trade.tp1 - entry) * (size * p1) * dir;
  const legBe = (bePrice - entry) * (size * (1 - p1)) * dir;
  return (legTp1 + legBe) / risk;
}

/**
 * Полный результат сделки (с частичными фиксациями и открытым остатком).
 * @param {import('../model/types.js').Trade} trade
 * @param {{ prices?: Record<string,number>, accountBalanceAtEntry?: number }} [ctx]
 */
export function computeTradeResult(trade, ctx = {}) {
  const dir = trade.direction === 'short' ? -1 : 1;
  const entry = trade.entry ?? trade.plannedEntry;
  const totalSize = trade.size || 0;
  const exits = normalizeExits(trade);

  const closedSize = exits.reduce((s, e) => s + e.size, 0);
  const openSize = Math.max(0, totalSize - closedSize);
  const fullyClosed = totalSize > 0 && openSize <= totalSize * 1e-6;
  const isOpen = trade.status === 'closed' ? false : !fullyClosed;

  const risk = initialRisk(trade); // от полного первоначального риска — всегда
  const refExit = ctx.prices?.[trade.symbol] ?? trade.currentPrice ?? null;

  const realizedGross = exits.reduce((s, e) => s + legPnl({ direction: trade.direction, entry, price: e.price, size: e.size }), 0);
  const unrealizedGross = !fullyClosed && refExit != null ? legPnl({ direction: trade.direction, entry, price: refExit, size: openSize }) : 0;

  const fees = trade.feesPaid ?? 0;
  const grossTotal = realizedGross + unrealizedGross;
  const net = grossTotal - fees;
  const realizedNet = realizedGross - fees; // упрощение Этапа 1: все комиссии на реализованную часть

  const avgExit = closedSize ? exits.reduce((s, e) => s + e.price * e.size, 0) / closedSize : null;
  const lastExitAt = exits.map((e) => e.at).filter(Boolean).sort().at(-1) || trade.closedAt || null;

  const finalTarget = trade.tp3 ?? trade.plannedTarget ?? trade.target;
  const rrPlanned =
    trade.plannedEntry != null && trade.plannedStop != null && finalTarget != null
      ? riskReward({ entry: trade.plannedEntry, stop: trade.plannedStop, target: finalTarget })
      : entry != null && initialStopOf(trade) != null && finalTarget != null
        ? riskReward({ entry, stop: initialStopOf(trade), target: finalTarget })
        : null;

  const balanceAtEntry = ctx.accountBalanceAtEntry;
  const workingStop = trade.breakevenAfterTp1 && exits.some((e) => e.kind === 'tp1')
    ? entry + (dir === 1 ? (trade.beBuffer || 0) : -(trade.beBuffer || 0))
    : (trade.workingStop ?? initialStopOf(trade));

  return {
    tradeId: trade.id,
    isOpen,
    fullyClosed,
    totalSize,
    closedSize,
    openSize,
    exits,
    refExit: fullyClosed ? avgExit : refExit,
    avgExit,
    workingStop,
    movedToBreakeven: !!trade.breakevenAfterTp1 && exits.some((e) => e.kind === 'tp1'),
    closedAt: fullyClosed ? lastExitAt : null,

    risk,
    initialRiskUsd: risk,
    potentialLoss: -risk,
    reward: finalTarget != null ? Math.abs(finalTarget - entry) * totalSize : null,
    rrPlanned,
    plannedR: blendedPlannedR(trade),
    protectedR: protectedR(trade),

    grossPnl: grossTotal,
    realizedPnl: realizedNet,
    unrealizedPnl: unrealizedGross,
    fees,
    pnl: net,
    rMultiple: rMultiple({ netPnl: net, risk }),
    realizedR: rMultiple({ netPnl: realizedNet, risk }),

    pnlPct: entry && totalSize ? (net / (entry * totalSize)) * 100 : 0,
    returnOnAccountPct: balanceAtEntry ? (net / balanceAtEntry) * 100 : null,
    riskPctOfAccount: balanceAtEntry ? (risk / balanceAtEntry) * 100 : null,
    holdingHours: holdingHours(trade),
    entrySlippagePct: entrySlippagePct(trade),

    isWin: !isOpen && net > 0,
    isLoss: !isOpen && net < 0,
    isBreakeven: !isOpen && Math.abs(net) < risk * 0.05, // ±5% риска считаем безубытком
  };
}

function frac(v) {
  if (v == null || Number.isNaN(v)) return 0;
  return v > 1 ? v / 100 : v; // принимаем и 0.4, и 40
}

// Совместимость со старым именем
export const tradeRisk = ({ entry, stop, size }) => Math.abs(entry - stop) * size;
export const tradeReward = ({ entry, target, size }) => (target == null ? null : Math.abs(target - entry) * size);
