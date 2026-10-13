// ── LocalStore — реализация контракта на LocalStorage ────────────────────────
// В браузере пишет в window.localStorage. В Node/тестах (localStorage нет)
// автоматически использует Map в памяти — тот же код, тот же контракт.
//
// Формат ключей: rjournal:v1:<коллекция>. Значение — JSON.

import {
  DEFAULT_SETTINGS,
  newId,
  STORE_METHODS,
  deriveStatus,
} from './store-interface.js';
import { LOCAL_USER_ID, LOCAL_ACCOUNT_ID, TradeSource } from '../model/enums.js';

const PREFIX = 'rjournal:v1:';
const K = {
  settings: PREFIX + 'settings',
  accounts: PREFIX + 'accounts',
  trades: PREFIX + 'trades',
  cashflows: PREFIX + 'cashflows',
  strategies: PREFIX + 'strategies',
  journal: PREFIX + 'journal',
};

/** In-memory адаптер с API localStorage (для Node и приватного режима). */
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

export class LocalStore {
  /** @param {{ storage?: Storage, now?: () => string }} [opts] */
  constructor(opts = {}) {
    this.storage =
      opts.storage ||
      (typeof globalThis.localStorage !== 'undefined' ? safeStorage(globalThis.localStorage) : memoryStorage());
    this.now = opts.now || (() => new Date().toISOString());
    this.userId = LOCAL_USER_ID;
    this.accountId = LOCAL_ACCOUNT_ID;
    this.isDemo = true; // отличает от SupabaseStore для UI (текст/кнопки в настройках)
  }

  _read(key, fallback) {
    const raw = this.storage.getItem(key);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  _write(key, value) {
    this.storage.setItem(key, JSON.stringify(value));
  }

  // ── accounts ──
  // Стартовый баланс/валюта физически хранятся здесь, не в settings — как и
  // в SupabaseStore (см. supabase/SCHEMA.md), чтобы поведение двух реализаций
  // не расходилось. На Этапе 2 UI по умолчанию один счёт на пользователя,
  // но список уже настоящий — добавление счетов не требует миграции данных.
  async listAccounts() {
    const list = this._read(K.accounts, []);
    if (list.length) return list;
    const legacy = this._read(K.settings, {}); // до этой версии баланс/валюта лежали здесь
    const acc = {
      id: this.accountId,
      userId: this.userId,
      name: 'Основной счёт',
      startingBalance: legacy.startingBalance ?? DEFAULT_SETTINGS.startingBalance,
      currency: legacy.baseCurrency ?? DEFAULT_SETTINGS.baseCurrency,
      isDemo: false,
      createdAt: this.now(),
    };
    this._write(K.accounts, [acc]);
    return [acc];
  }
  async createAccount(data) {
    const list = await this.listAccounts();
    const acc = {
      id: newId(), userId: this.userId, name: 'Счёт', startingBalance: 0,
      currency: DEFAULT_SETTINGS.baseCurrency, isDemo: false, createdAt: this.now(),
      ...data,
    };
    list.push(acc);
    this._write(K.accounts, list);
    return acc;
  }
  /** Удаляет счёт вместе с его сделками и движениями средств (как cascade в Supabase). Нельзя удалить последний счёт. */
  async deleteAccount(id) {
    const list = await this.listAccounts();
    if (list.length <= 1) throw new Error('Нельзя удалить последний счёт');
    this._write(K.accounts, list.filter((a) => a.id !== id));
    this._write(K.trades, (await this.listTrades()).filter((t) => t.accountId !== id));
    this._write(K.cashflows, (await this.listCashflows()).filter((c) => c.accountId !== id));
  }

  // ── settings (параметры калькулятора риска; startingBalance/baseCurrency — из accounts) ──
  async getSettings() {
    const accounts = await this.listAccounts();
    const acc = accounts.find((a) => a.id === this.accountId) ?? accounts[0];
    return {
      ...DEFAULT_SETTINGS,
      ...this._read(K.settings, {}),
      startingBalance: acc.startingBalance,
      baseCurrency: acc.currency,
    };
  }
  async updateSettings(patch) {
    const accPatch = {};
    if ('startingBalance' in patch) accPatch.startingBalance = patch.startingBalance;
    if ('baseCurrency' in patch) accPatch.currency = patch.baseCurrency;
    if (Object.keys(accPatch).length) {
      const accounts = await this.listAccounts();
      const i = accounts.findIndex((a) => a.id === this.accountId);
      accounts[i === -1 ? 0 : i] = { ...accounts[i === -1 ? 0 : i], ...accPatch };
      this._write(K.accounts, accounts);
    }
    const riskPatch = { ...patch };
    delete riskPatch.startingBalance;
    delete riskPatch.baseCurrency;
    this._write(K.settings, { ...this._read(K.settings, {}), ...riskPatch });
    return this.getSettings();
  }
  /** В локальном режиме наставников нет. */
  async getMyMentor() {
    return null;
  }
  /** В локальном режиме наставников нет — и комментариев тоже. */
  async listTradeComments() {
    return [];
  }

  // ── trades ──
  async listTrades() {
    return this._read(K.trades, []);
  }
  async getTrade(id) {
    return (await this.listTrades()).find((t) => t.id === id) ?? null;
  }
  async createTrade(data) {
    const trades = await this.listTrades();
    const ts = this.now();
    /** @type {import('../model/types.js').Trade} */
    const trade = {
      id: newId(),
      userId: this.userId,
      accountId: this.accountId,
      source: TradeSource.MANUAL,
      marketType: 'futures',
      screenshotUrls: [],
      tags: [],
      mistakes: [],
      exits: [],
      createdAt: ts,
      updatedAt: ts,
      ...data,
    };
    trade.status = deriveStatus(trade);
    trades.push(trade);
    this._write(K.trades, trades);
    return trade;
  }
  async updateTrade(id, patch) {
    const trades = await this.listTrades();
    const i = trades.findIndex((t) => t.id === id);
    if (i === -1) throw new Error('Сделка не найдена: ' + id);
    const next = { ...trades[i], ...patch, updatedAt: this.now() };
    if ('exit' in patch || 'exits' in patch || 'size' in patch || 'status' in patch) {
      next.status = deriveStatus(next);
    }
    trades[i] = next;
    this._write(K.trades, trades);
    return next;
  }
  async deleteTrade(id) {
    this._write(K.trades, (await this.listTrades()).filter((t) => t.id !== id));
  }

  // ── cashflows ──
  async listCashflows() {
    return this._read(K.cashflows, []);
  }
  async createCashflow(data) {
    const list = await this.listCashflows();
    const cf = { id: newId(), accountId: this.accountId, date: this.now(), ...data };
    list.push(cf);
    this._write(K.cashflows, list);
    return cf;
  }
  async deleteCashflow(id) {
    this._write(K.cashflows, (await this.listCashflows()).filter((c) => c.id !== id));
  }

  // ── strategies ──
  async listStrategies() {
    return this._read(K.strategies, []);
  }
  async createStrategy(data) {
    const list = await this.listStrategies();
    const s = { id: newId(), userId: this.userId, rules: [], ...data };
    list.push(s);
    this._write(K.strategies, list);
    return s;
  }
  async updateStrategy(id, patch) {
    const list = await this.listStrategies();
    const i = list.findIndex((s) => s.id === id);
    if (i === -1) throw new Error('Стратегия не найдена: ' + id);
    list[i] = { ...list[i], ...patch };
    this._write(K.strategies, list);
    return list[i];
  }

  // ── journal entries (заметки / еженедельный обзор) ──
  async listJournalEntries() {
    return this._read(K.journal, []);
  }
  async createJournalEntry(data) {
    const list = await this.listJournalEntries();
    const ts = this.now();
    const entry = { id: newId(), userId: this.userId, type: 'note', title: '', body: '', createdAt: ts, updatedAt: ts, ...data };
    list.push(entry);
    this._write(K.journal, list);
    return entry;
  }
  async updateJournalEntry(id, patch) {
    const list = await this.listJournalEntries();
    const i = list.findIndex((e) => e.id === id);
    if (i === -1) throw new Error('Запись не найдена: ' + id);
    list[i] = { ...list[i], ...patch, updatedAt: this.now() };
    this._write(K.journal, list);
    return list[i];
  }
  async deleteJournalEntry(id) {
    this._write(K.journal, (await this.listJournalEntries()).filter((e) => e.id !== id));
  }

  // ── служебное ──
  async clearAll() {
    Object.values(K).forEach((k) => this.storage.removeItem(k));
  }
  async exportDump() {
    return {
      version: 1,
      exportedAt: this.now(),
      settings: await this.getSettings(),
      accounts: await this.listAccounts(),
      trades: await this.listTrades(),
      cashflows: await this.listCashflows(),
      strategies: await this.listStrategies(),
      journal: await this.listJournalEntries(),
    };
  }
  async importDump(dump) {
    if (dump.settings) this._write(K.settings, dump.settings);
    if (dump.accounts) this._write(K.accounts, dump.accounts);
    if (dump.trades) this._write(K.trades, dump.trades);
    if (dump.cashflows) this._write(K.cashflows, dump.cashflows);
    if (dump.strategies) this._write(K.strategies, dump.strategies);
    if (dump.journal) this._write(K.journal, dump.journal);
  }
}

/** Оборачивает localStorage так, чтобы упавший setItem (квота/приватный режим) не ронял приложение. */
function safeStorage(ls) {
  return {
    getItem: (k) => {
      try {
        return ls.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k, v) => {
      try {
        ls.setItem(k, v);
      } catch {
        /* приватный режим / переполнение — молча игнорируем */
      }
    },
    removeItem: (k) => {
      try {
        ls.removeItem(k);
      } catch {
        /* noop */
      }
    },
  };
}

/** Проверка соответствия контракту. */
export function implementsStoreContract(obj) {
  return STORE_METHODS.every((m) => typeof obj[m] === 'function');
}
