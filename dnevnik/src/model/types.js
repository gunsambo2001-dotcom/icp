// JSDoc-типы домена. Это единственный источник правды по форме данных.
// Именование — camelCase в JS; адаптер Supabase на Этапе 2 маппит в snake_case.
// Денежные значения — number в базовой валюте счёта (по умолчанию USDT).
// Даты — ISO-8601 строки ("2026-09-09T10:05:00.000Z").

/**
 * @typedef {'long'|'short'} Direction
 * @typedef {'futures'|'spot'} MarketType
 * @typedef {'open'|'closed'} TradeStatus
 * @typedef {'manual'|'shorthand'|'screenshot'|'import'} TradeSource
 * @typedef {'high'|'medium'|'low'} FieldConfidence
 * @typedef {'asia'|'london'|'newyork'} Session
 * @typedef {'deposit'|'withdrawal'} CashflowType
 * @typedef {'student'|'mentor'|'admin'} UserRole
 */

/**
 * Пользователь. На Этапе 1 существует один локальный пользователь.
 * @typedef {Object} User
 * @property {string} id
 * @property {UserRole} role
 * @property {string} [email]
 * @property {string} [displayName]
 * @property {string|null} [mentorId]   — id наставника (для вида "мои ученики")
 * @property {string} timezone          — IANA, напр. "Asia/Irkutsk"
 * @property {string} baseCurrency      — напр. "USDT"
 * @property {string} createdAt
 */

/**
 * Торговый счёт. У пользователя может быть несколько (реал/демо/биржи).
 * @typedef {Object} Account
 * @property {string} id
 * @property {string} userId
 * @property {string} name
 * @property {number} startingBalance
 * @property {string} currency
 * @property {string} [exchange]        — напр. "BingX"
 * @property {MarketType} [defaultMarket]
 * @property {string} createdAt
 */

/**
 * Ввод/вывод средств. Влияет на баланс и кривую капитала, но не на статистику сделок.
 * @typedef {Object} Cashflow
 * @property {string} id
 * @property {string} accountId
 * @property {CashflowType} type
 * @property {number} amount            — всегда положительное; знак задаёт type
 * @property {string} date             — ISO
 * @property {string} [note]
 */

/**
 * Стратегия / сетап. Привязка к модулю курса — через moduleRef.
 * @typedef {Object} Strategy
 * @property {string} id
 * @property {string} userId
 * @property {string} name
 * @property {string} [description]
 * @property {string} [moduleRef]       — напр. "Модуль 3: пробой уровня"
 * @property {string[]} [rules]         — чек-лист входа
 * @property {boolean} [archived]
 */

/**
 * Сделка. Разделяем ПЛАН (как размечал до входа) и ФАКТ (как исполнилось).
 * Расчётные поля (pnl, rMultiple, rr…) НЕ хранятся — считаются в calc/trade.js.
 *
 * @typedef {Object} Trade
 * @property {string} id
 * @property {string} userId
 * @property {string} accountId
 * @property {string} symbol            — "BTCUSDT"
 * @property {Direction} direction
 * @property {MarketType} marketType
 * @property {TradeStatus} status
 *
 * @property {string|null} [strategyId]
 * @property {string} [strategyName]    — денормализовано для отображения
 * @property {Session} [session]
 * @property {string} [timeframe]       — "1h", "15m"
 * @property {number} [leverage]        — 1 для спота
 *
 * @property {string} openedAt          — ISO, время входа
 * @property {string|null} [closedAt]   — ISO, время выхода (null пока открыта)
 *
 * // --- ПЛАН (разметка до входа) ---
 * @property {number} plannedEntry
 * @property {number} plannedStop       — первоначальный стоп = база риска и R
 * @property {number} [plannedTarget]   — совместимость; = tp3
 *
 * // --- ФАКТ ---
 * @property {number} entry             — фактическая (средняя) цена входа
 * @property {number} initialStop       — первоначальный стоп; 1R фиксируется здесь и не пересчитывается
 * @property {number} [workingStop]     — текущий стоп (после TP1 может = безубыток)
 * @property {number} size              — ПОЛНЫЙ размер позиции в базовом активе (напр. BTC)
 * @property {number|null} [currentPrice] — текущая цена, для оценки открытого остатка
 * @property {number} [feesPaid]        — суммарные комиссии+фандинг по факту, $
 *
 * // --- цели и частичные фиксации ---
 * @property {number} [tp1]             — первая цель (частичная фиксация)
 * @property {number} [tp2]             — вторая цель (частичная фиксация)
 * @property {number} [tp3]             — финальная цель (полное закрытие остатка)
 * @property {number} [tp1Pct]          — доля позиции, закрываемая на TP1 (0..1; принимается и 40)
 * @property {number} [tp2Pct]          — доля позиции, закрываемая на TP2
 * @property {boolean} [breakevenAfterTp1] — после TP1 стоп остатка → безубыток
 * @property {number} [beBuffer]        — буфер безубытка от входа в цене (0 = ровно вход)
 * @property {TradeExit[]} [exits]      — фактические закрытия (частичные и финальные)
 *
 * // --- legacy (поддерживаются нормализатором в calc/trade.js) ---
 * @property {number} [stop]
 * @property {number} [target]
 * @property {number|null} [exit]
 * @property {string|null} [closedAt] (см. ниже)
 *
 * // --- журнал ---
 * @property {string[]} [screenshotUrls]
 * @property {string} [notes]
 * @property {string[]} [mistakes]
 * @property {string[]} [tags]
 * @property {number} [checklistScore]  — 0..5 соблюдение чек-листа
 * @property {boolean} [ruleViolation]
 *
 * // --- происхождение данных (под OCR) ---
 * @property {TradeSource} source
 * @property {Record<string, FieldConfidence>} [fieldConfidence]
 *
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Запись журнала: свободная заметка или еженедельный обзор.
 * @typedef {Object} JournalEntry
 * @property {string} id
 * @property {string} userId
 * @property {'note'|'weekly'} type
 * @property {string} title
 * @property {string} body            — текст (простой, с переносами строк)
 * @property {string} [weekOf]        — ISO-дата понедельника недели (для type='weekly')
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Одно фактическое закрытие части (или всей) позиции.
 * @typedef {Object} TradeExit
 * @property {'tp1'|'tp2'|'tp3'|'stop'|'be'|'manual'} kind
 * @property {number} price
 * @property {number} size   — размер этого закрытия в базовом активе
 * @property {string} [at]   — ISO-время
 */

/**
 * Настройки пользователя/счёта для Этапа 1 (плоско, один счёт).
 * @typedef {Object} Settings
 * @property {number} startingBalance
 * @property {string} baseCurrency
 * @property {string} timezone
 * @property {number} defaultRiskPct   — риск на сделку по умолчанию, %
 * @property {number} defaultLeverage
 * @property {number} commissionRatePct — тейкер, % за одну сторону
 * @property {number} defaultSlippagePct
 * @property {number} fundingRatePct    — %/8ч по умолчанию
 * @property {number} tp1ClosePct       — доля позиции на TP1 по умолчанию, % (напр. 40)
 * @property {number} tp2ClosePct       — доля позиции на TP2 по умолчанию, %
 * @property {number} beBuffer          — буфер безубытка по умолчанию, в цене
 * @property {boolean} breakevenAfterTp1 — переносить стоп в БУ после TP1 по умолчанию
 */

export {}; // модуль без runtime-экспортов, только типы
