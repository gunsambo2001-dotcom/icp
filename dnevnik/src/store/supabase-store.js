// ── SupabaseStore — реализация контракта на Supabase Postgres + RLS ─────────
// Тот же интерфейс, что у LocalStore (см. store-interface.js): вызывающий код
// (ui/app.js) не знает, с каким store работает. Изоляция данных между
// пользователями обеспечена на уровне БД (RLS-политики в supabase/schema.sql),
// не в этом файле — здесь только маппинг camelCase ↔ snake_case и работа с
// таблицей accounts (в Этапе 2 UI — один счёт на пользователя, но схема и
// адаптер уже поддерживают несколько; см. supabase/SCHEMA.md).

import { DEFAULT_SETTINGS, newId, STORE_METHODS, deriveStatus } from './store-interface.js';
import { camelToSnake, snakeToCamel, camelToSnakeKey } from './case-map.js';

// Поля Settings, которые физически живут в таблице settings (параметры калькулятора риска).
const RISK_SETTINGS_KEYS = [
  'defaultRiskPct', 'defaultLeverage', 'commissionRatePct', 'defaultSlippagePct',
  'fundingRatePct', 'tp1ClosePct', 'tp2ClosePct', 'beBuffer', 'breakevenAfterTp1',
];

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const toDbTrade = camelToSnake;
const fromDbTrade = snakeToCamel;

export class SupabaseStore {
  /** @param {import('@supabase/supabase-js').SupabaseClient} client */
  constructor(client) {
    this.client = client;
    this.isDemo = false;
    this._userId = null;
    this._accountId = null;
  }

  async _uid() {
    if (this._userId) return this._userId;
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Нет активной сессии Supabase');
    this._userId = data.user.id;
    return this._userId;
  }

  /** Счёт по умолчанию (первый по created_at). Многосчётный UI — задел на будущее. */
  async _aid() {
    if (this._accountId) return this._accountId;
    const userId = await this._uid();
    const row = unwrap(
      await this.client.from('accounts').select('id').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).single(),
    );
    this._accountId = row.id;
    return this._accountId;
  }

  // ── accounts ──
  async listAccounts() {
    const userId = await this._uid();
    const rows = unwrap(await this.client.from('accounts').select('*').eq('user_id', userId).order('created_at', { ascending: true }));
    return rows.map(snakeToCamel);
  }
  async createAccount(data) {
    const userId = await this._uid();
    const row = unwrap(
      await this.client.from('accounts').insert(camelToSnake({
        id: newId(), userId, name: 'Счёт', startingBalance: 0, currency: 'USDT', isDemo: false, ...data,
      })).select().single(),
    );
    return snakeToCamel(row);
  }
  /** Удаляет счёт; сделки и движения средств уходят каскадом (schema.sql: on delete cascade). Нельзя удалить последний счёт. */
  async deleteAccount(id) {
    const accounts = await this.listAccounts();
    if (accounts.length <= 1) throw new Error('Нельзя удалить последний счёт');
    unwrap(await this.client.from('accounts').delete().eq('id', id));
    if (this._accountId === id) this._accountId = null;
  }

  // ── settings (+ то, что физически лежит в accounts/profiles) ──
  async getSettings() {
    const userId = await this._uid();
    const accountId = await this._aid();
    const [settingsRow, accountRow, profileRow] = await Promise.all([
      this.client.from('settings').select('*').eq('user_id', userId).maybeSingle().then(unwrap),
      this.client.from('accounts').select('starting_balance, currency').eq('id', accountId).single().then(unwrap),
      this.client.from('profiles').select('timezone, display_name').eq('id', userId).single().then(unwrap),
    ]);
    return {
      ...DEFAULT_SETTINGS,
      ...snakeToCamel(settingsRow ?? {}),
      startingBalance: Number(accountRow.starting_balance),
      baseCurrency: accountRow.currency,
      timezone: profileRow.timezone,
      displayName: profileRow.display_name ?? '',
    };
  }

  /** Наставник текущего пользователя ({id, displayName}) или null. Читается по RLS-политике profiles_select_my_mentor. */
  async getMyMentor() {
    const userId = await this._uid();
    const me = unwrap(await this.client.from('profiles').select('mentor_id').eq('id', userId).single());
    if (!me.mentor_id) return null;
    const mentor = unwrap(await this.client.from('profiles').select('display_name').eq('id', me.mentor_id).maybeSingle());
    return { id: me.mentor_id, displayName: mentor?.display_name ?? '' };
  }

  /**
   * Комментарии наставника к моей сделке (по времени). Явный фильтр по владельцу сделки — как в
   * listTrades: у наставника/админа RLS шире, а в своём дневнике должны быть только комментарии к своим сделкам.
   */
  async listTradeComments(tradeId) {
    const userId = await this._uid();
    const rows = unwrap(
      await this.client.from('trade_comments').select('*, trades!inner(user_id)').eq('trade_id', tradeId).eq('trades.user_id', userId).order('created_at', { ascending: true }),
    );
    return rows.map(({ trades, ...row }) => snakeToCamel(row));
  }

  async updateSettings(patch) {
    const userId = await this._uid();
    const accountId = await this._aid();
    const accountPatch = {};
    if ('startingBalance' in patch) accountPatch.starting_balance = patch.startingBalance;
    if ('baseCurrency' in patch) accountPatch.currency = patch.baseCurrency;
    const profilePatch = {};
    if ('timezone' in patch) profilePatch.timezone = patch.timezone;
    if ('displayName' in patch) profilePatch.display_name = String(patch.displayName ?? '').trim().slice(0, 100) || null;
    const settingsPatch = {};
    for (const k of RISK_SETTINGS_KEYS) if (k in patch) settingsPatch[camelToSnakeKey(k)] = patch[k];

    const jobs = [];
    if (Object.keys(accountPatch).length) jobs.push(this.client.from('accounts').update(accountPatch).eq('id', accountId));
    if (Object.keys(profilePatch).length) jobs.push(this.client.from('profiles').update(profilePatch).eq('id', userId));
    if (Object.keys(settingsPatch).length) jobs.push(this.client.from('settings').update(settingsPatch).eq('user_id', userId));
    for (const j of jobs) unwrap(await j);
    return this.getSettings();
  }

  // ── trades ──
  // Явный фильтр по user_id обязателен: у наставника/админа RLS разрешает читать
  // и чужие сделки, а в собственном дневнике должны быть только его собственные.
  async listTrades() {
    const userId = await this._uid();
    const rows = unwrap(await this.client.from('trades').select('*').eq('user_id', userId).order('opened_at', { ascending: false }));
    return rows.map(fromDbTrade);
  }
  async getTrade(id) {
    const userId = await this._uid();
    const row = unwrap(await this.client.from('trades').select('*').eq('id', id).eq('user_id', userId).maybeSingle());
    return row ? fromDbTrade(row) : null;
  }
  async createTrade(data) {
    const userId = await this._uid();
    const accountId = await this._aid();
    const trade = {
      id: newId(), userId, accountId, source: 'manual', marketType: 'futures',
      screenshotUrls: [], tags: [], mistakes: [], exits: [],
      ...data,
    };
    trade.status = deriveStatus(trade);
    const row = unwrap(await this.client.from('trades').insert(toDbTrade(trade)).select().single());
    return fromDbTrade(row);
  }
  async updateTrade(id, patch) {
    const current = await this.getTrade(id);
    if (!current) throw new Error('Сделка не найдена: ' + id);
    const next = { ...current, ...patch };
    const patchToSend = { ...patch };
    if ('exit' in patch || 'exits' in patch || 'size' in patch || 'status' in patch) {
      patchToSend.status = deriveStatus(next);
    }
    const row = unwrap(await this.client.from('trades').update(toDbTrade(patchToSend)).eq('id', id).select().single());
    return fromDbTrade(row);
  }
  async deleteTrade(id) {
    unwrap(await this.client.from('trades').delete().eq('id', id));
  }

  // ── cashflows ──
  // Данные по ВСЕМ счетам текущего пользователя (не только счёту по умолчанию),
  // и только ему принадлежащие: как и в listTrades(), фильтр явный, а не только RLS.
  async listCashflows() {
    const accountIds = (await this.listAccounts()).map((a) => a.id);
    if (!accountIds.length) return [];
    const rows = unwrap(await this.client.from('cashflows').select('*').in('account_id', accountIds).order('date', { ascending: false }));
    return rows.map(snakeToCamel);
  }
  async createCashflow(data) {
    const accountId = await this._aid();
    const row = unwrap(
      await this.client.from('cashflows').insert(camelToSnake({ id: newId(), accountId, date: new Date().toISOString(), ...data })).select().single(),
    );
    return snakeToCamel(row);
  }
  async deleteCashflow(id) {
    unwrap(await this.client.from('cashflows').delete().eq('id', id));
  }

  // ── strategies ──
  async listStrategies() {
    const userId = await this._uid();
    const rows = unwrap(await this.client.from('strategies').select('*').eq('user_id', userId));
    return rows.map(snakeToCamel);
  }
  async createStrategy(data) {
    const userId = await this._uid();
    const row = unwrap(
      await this.client.from('strategies').insert(camelToSnake({ id: newId(), userId, rules: [], ...data })).select().single(),
    );
    return snakeToCamel(row);
  }
  async updateStrategy(id, patch) {
    const row = unwrap(await this.client.from('strategies').update(camelToSnake(patch)).eq('id', id).select().single());
    return snakeToCamel(row);
  }

  // ── journal entries ──
  async listJournalEntries() {
    const userId = await this._uid();
    const rows = unwrap(await this.client.from('journal_entries').select('*').eq('user_id', userId).order('created_at', { ascending: false }));
    return rows.map(snakeToCamel);
  }
  async createJournalEntry(data) {
    const userId = await this._uid();
    const row = unwrap(
      await this.client.from('journal_entries').insert(camelToSnake({ id: newId(), userId, type: 'note', title: '', body: '', ...data })).select().single(),
    );
    return snakeToCamel(row);
  }
  async updateJournalEntry(id, patch) {
    const row = unwrap(await this.client.from('journal_entries').update(camelToSnake(patch)).eq('id', id).select().single());
    return snakeToCamel(row);
  }
  async deleteJournalEntry(id) {
    unwrap(await this.client.from('journal_entries').delete().eq('id', id));
  }

  // ── служебное ──
  async clearAll() {
    const userId = await this._uid();
    const accountIds = (await this.listAccounts()).map((a) => a.id);
    unwrap(await this.client.from('trades').delete().eq('user_id', userId));
    if (accountIds.length) unwrap(await this.client.from('cashflows').delete().in('account_id', accountIds));
    unwrap(await this.client.from('journal_entries').delete().eq('user_id', userId));
    unwrap(await this.client.from('strategies').delete().eq('user_id', userId));
  }
  async exportDump() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: await this.getSettings(),
      trades: await this.listTrades(),
      cashflows: await this.listCashflows(),
      strategies: await this.listStrategies(),
      journal: await this.listJournalEntries(),
    };
  }
  async importDump(dump) {
    if (dump.settings) {
      const { displayName, ...settings } = dump.settings; // имя профиля из чужого файла не подставляем
      await this.updateSettings(settings);
    }
    for (const t of dump.trades || []) await this.createTrade(t);
    for (const c of dump.cashflows || []) await this.createCashflow(c);
    for (const s of dump.strategies || []) await this.createStrategy(s);
    for (const j of dump.journal || []) await this.createJournalEntry(j);
  }
}

/** Проверка соответствия контракту (как у LocalStore). */
export function implementsStoreContract(obj) {
  return STORE_METHODS.every((m) => typeof obj[m] === 'function');
}
