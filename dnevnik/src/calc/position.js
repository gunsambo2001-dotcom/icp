// ── Расчёты позиции ──────────────────────────────────────────────────────────
// Формулы перенесены один-в-один из калькулятора https://kalkulyator-icp.netlify.app
// (Guncambo Crypto Academy). Дневник и калькулятор ОБЯЗАНЫ давать одинаковые числа.
//
// Все функции чистые: на вход — числа, на выход — числа. Ни DOM, ни хранилища.
// Проценты передаются как есть (1 = 1%, не 0.01).
//
// Ключевой принцип калькулятора:
//   объём позиции выводится ИЗ риска и расстояния до стопа,
//   убыток в $ фиксирован и не зависит от того, где стоит стоп.
//   Плечо не меняет макс. убыток — только маржу и близость ликвидации.

/** Расстояние до стопа в % цены. @returns {number} */
export function stopPct({ entry, stop }) {
  guardPositive({ entry });
  return (Math.abs(entry - stop) / entry) * 100;
}

/** Расстояние до тейка в % цены. @returns {number} */
export function targetPct({ entry, target }) {
  guardPositive({ entry });
  return (Math.abs(entry - target) / entry) * 100;
}

/** Risk/Reward как отношение (3 == "1:3"). @returns {number} */
export function riskReward({ entry, stop, target }) {
  const s = stopPct({ entry, stop });
  if (s === 0) return 0;
  return targetPct({ entry, target }) / s;
}

/** Риск в деньгах: Депозит × Риск% / 100. @returns {number} */
export function riskAmount({ deposit, riskPct }) {
  return (deposit * riskPct) / 100;
}

/** Общий объём позиции (номинал), $: Риск$ / Стоп% × 100. @returns {number} */
export function totalVolume({ deposit, riskPct, entry, stop }) {
  const s = stopPct({ entry, stop });
  if (s === 0) return 0;
  return (riskAmount({ deposit, riskPct }) / s) * 100;
}

/** Маржа (замороженный залог), $: Общий объём / Плечо. @returns {number} */
export function marginRequired({ totalVolume: vol, leverage }) {
  return vol / (leverage || 1);
}

/** Количество базового актива: Общий объём / Цена входа. @returns {number} */
export function positionQty({ totalVolume: vol, entry }) {
  guardPositive({ entry });
  return vol / entry;
}

/** Комиссия биржи, $: Общий объём × Ставка% / 100 × 2 (вход + выход). @returns {number} */
export function commission({ totalVolume: vol, ratePct }) {
  return ((vol * ratePct) / 100) * 2;
}

/** Фандинг, $: Общий объём × Ставка% / 100 × (Часы / 8). @returns {number} */
export function funding({ totalVolume: vol, ratePct, hours }) {
  return ((vol * ratePct) / 100) * (hours / 8);
}

/** Проскальзывание, $: Общий объём × Слиппедж% / 100 × 2 (вход + выход). @returns {number} */
export function slippageCost({ totalVolume: vol, slippagePct }) {
  return ((vol * slippagePct) / 100) * 2;
}

/** Движение цены до ликвидации, % (приближённо): 100 / Плечо. @returns {number} */
export function liquidationMovePct({ leverage }) {
  if (!leverage || leverage <= 0) return Infinity;
  return 100 / leverage;
}

/** Цена ликвидации (приближённо, без учёта поддерживающей маржи). @returns {number} */
export function liquidationPrice({ entry, leverage, direction }) {
  const move = (entry * liquidationMovePct({ leverage })) / 100;
  return direction === 'short' ? entry + move : entry - move;
}

/** Запас безопасности: от стопа до ликвидации, % цены. Отрицательное = стоп за ликвидацией. */
export function safetyMarginPct({ entry, stop, leverage }) {
  return liquidationMovePct({ leverage }) - stopPct({ entry, stop });
}

/** Убыток при срабатывании стопа, $. @returns {number} */
export function lossAtStop({ totalVolume: vol, entry, stop }) {
  guardPositive({ entry });
  return (vol * Math.abs(entry - stop)) / entry;
}

/** Прибыль при достижении тейка, $. @returns {number} */
export function profitAtTarget({ totalVolume: vol, entry, target }) {
  guardPositive({ entry });
  return (vol * Math.abs(entry - target)) / entry;
}

/**
 * Полный расчёт плана сделки — то, что вызывают и калькулятор, и форма дневника.
 * @param {Object} input
 * @param {number} input.deposit
 * @param {number} input.riskPct
 * @param {number} input.entry
 * @param {number} input.stop
 * @param {number} input.target
 * @param {'long'|'short'} input.direction
 * @param {number} [input.leverage=1]
 * @param {number} [input.commissionRatePct=0]
 * @param {number} [input.slippagePct=0]
 * @param {number} [input.fundingRatePct=0]
 * @param {number} [input.holdHours=0]
 * @returns {Object} все выходные значения плана
 */
export function computePlan(input) {
  const {
    deposit, riskPct, entry, stop, target, direction,
    leverage = 1,
    commissionRatePct = 0,
    slippagePct = 0,
    fundingRatePct = 0,
    holdHours = 0,
  } = input;

  const sPct = stopPct({ entry, stop });
  const tPct = targetPct({ entry, target });
  const risk$ = riskAmount({ deposit, riskPct });
  const vol = totalVolume({ deposit, riskPct, entry, stop });
  const margin = marginRequired({ totalVolume: vol, leverage });
  const qty = positionQty({ totalVolume: vol, entry });

  const feesComm = commission({ totalVolume: vol, ratePct: commissionRatePct });
  const feesSlip = slippageCost({ totalVolume: vol, slippagePct });
  const feesFund = funding({ totalVolume: vol, ratePct: fundingRatePct, hours: holdHours });
  const feesTotal = feesComm + feesSlip + feesFund;

  const grossLoss = lossAtStop({ totalVolume: vol, entry, stop });
  const grossProfit = profitAtTarget({ totalVolume: vol, entry, target });

  return {
    direction,
    stopPct: sPct,
    targetPct: tPct,
    riskReward: sPct === 0 ? 0 : tPct / sPct,
    riskAmount: risk$,
    totalVolume: vol,
    marginRequired: margin,
    positionQty: qty,

    fees: { commission: feesComm, slippage: feesSlip, funding: feesFund, total: feesTotal },

    lossAtStop: grossLoss,
    profitAtTarget: grossProfit,
    netLossAtStop: grossLoss + feesTotal,
    netProfitAtTarget: grossProfit - feesTotal,
    lossPctOfDeposit: deposit ? ((grossLoss + feesTotal) / deposit) * 100 : 0,
    profitPctOfDeposit: deposit ? ((grossProfit - feesTotal) / deposit) * 100 : 0,

    liquidationMovePct: liquidationMovePct({ leverage }),
    liquidationPrice: liquidationPrice({ entry, leverage, direction }),
    safetyMarginPct: safetyMarginPct({ entry, stop, leverage }),
    liquidationBeforeStop: safetyMarginPct({ entry, stop, leverage }) < 0,
  };
}

function guardPositive({ entry }) {
  if (!(entry > 0)) throw new RangeError('entry (цена входа) должна быть > 0');
}
