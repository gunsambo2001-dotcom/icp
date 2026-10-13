// ── MentorStore — данные кабинета наставника (только Supabase) ──────────────
// Не входит в контракт JournalStore: у ученика и в демо-режиме кабинета нет.
// main.js читает роль и, только для mentor/admin, передаёт MentorStore в startApp().
//
// Безопасность: базовая защита — RLS в БД (supabase/migrations/001, 002). Но у
// роли admin RLS разрешает читать ВСЕХ, поэтому здесь каждый запрос ещё и явно
// ограничен «моими учениками» (profiles.mentor_id = я). Не полагаться на RLS в
// списках — та же ошибка, что закрыта в SupabaseStore (Этап B).

import { computeStats, openTradePrices } from '../calc/index.js';
import { snakeToCamel } from './case-map.js';

const PAGE = 1000; // лимит строк одного ответа PostgREST — без постраничного чтения данные обрезались бы молча
const MAX_COMMENT = 4000; // как check в trade_comments

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/** Читает все страницы запроса. makeQuery() каждый раз строит запрос заново; порядок по id — для стабильной пагинации. */
async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = unwrap(await makeQuery().order('id', { ascending: true }).range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function groupByKey(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return map;
}

/** Текст комментария: без пробелов по краям, непустой, не длиннее лимита БД. */
function cleanComment(text) {
  const value = String(text ?? '').trim();
  if (!value) throw new Error('Комментарий не может быть пустым');
  if (value.length > MAX_COMMENT) throw new Error(`Комментарий длиннее ${MAX_COMMENT} символов`);
  return value;
}

/**
 * Сводка по ученику из его сырых данных — та же статистика, что у дневника (computeStats),
 * новых показателей нет.
 * @param {{accounts: any[], trades: any[], cashflows: any[]}} data
 */
export function summarizeStudent({ accounts, trades, cashflows }) {
  const startingBalance = accounts.reduce((sum, a) => sum + (Number(a.startingBalance) || 0), 0);
  const stats = computeStats(trades, { startingBalance, cashflows, prices: openTradePrices(trades) });
  let lastTradeAt = null;
  for (const t of trades) if (t.openedAt && (!lastTradeAt || t.openedAt > lastTradeAt)) lastTradeAt = t.openedAt;
  return { stats, tradesCount: trades.length, lastTradeAt };
}

export class MentorStore {
  /** @param {import('@supabase/supabase-js').SupabaseClient} client */
  constructor(client) {
    this.client = client;
    this._userId = null;
  }

  async _uid() {
    if (this._userId) return this._userId;
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error('Нет активной сессии Supabase');
    this._userId = data.user.id;
    return this._userId;
  }

  /** id текущего наставника — чтобы UI отличал свои комментарии от чужих. */
  async getMyId() {
    return this._uid();
  }

  /** Роль текущего пользователя: 'student' | 'mentor' | 'admin'. */
  async getMyRole() {
    const userId = await this._uid();
    const row = unwrap(await this.client.from('profiles').select('role').eq('id', userId).single());
    return row.role;
  }

  /** Ученики текущего наставника (только mentor_id = я) — без данных о сделках. */
  async listStudents() {
    const userId = await this._uid();
    const rows = unwrap(
      await this.client.from('profiles').select('id, display_name, status, created_at').eq('mentor_id', userId).order('display_name', { ascending: true }),
    );
    return rows.map(snakeToCamel);
  }

  /** Данные всех моих учеников: [{student, accounts, trades, cashflows}]. */
  async loadRoster() {
    return this._loadData(await this.listStudents());
  }

  /** Данные одного ученика; бросает ошибку, если он не мой. */
  async loadStudent(studentId) {
    const userId = await this._uid();
    const row = unwrap(
      await this.client.from('profiles').select('id, display_name, status, created_at').eq('id', studentId).eq('mentor_id', userId).maybeSingle(),
    );
    if (!row) throw new Error('Ученик не найден или не закреплён за вами');
    return (await this._loadData([snakeToCamel(row)]))[0];
  }

  async _loadData(students) {
    if (!students.length) return [];
    const ids = students.map((s) => s.id);
    const [accountRows, tradeRows] = await Promise.all([
      fetchAll(() => this.client.from('accounts').select('*').in('user_id', ids)),
      fetchAll(() => this.client.from('trades').select('*').in('user_id', ids)),
    ]);
    const accountIds = accountRows.map((a) => a.id);
    const cashflowRows = accountIds.length ? await fetchAll(() => this.client.from('cashflows').select('*').in('account_id', accountIds)) : [];

    const accountOwner = new Map(accountRows.map((a) => [a.id, a.user_id]));
    const accountsBy = groupByKey(accountRows, (a) => a.user_id);
    const tradesBy = groupByKey(tradeRows, (t) => t.user_id);
    const cashflowsBy = groupByKey(cashflowRows, (c) => accountOwner.get(c.account_id));
    return students.map((student) => ({
      student,
      accounts: (accountsBy.get(student.id) ?? []).map(snakeToCamel),
      trades: (tradesBy.get(student.id) ?? []).map(snakeToCamel).sort((a, b) => (b.openedAt ?? '').localeCompare(a.openedAt ?? '')),
      cashflows: (cashflowsBy.get(student.id) ?? []).map(snakeToCamel),
    }));
  }

  // ── комментарии наставника к сделкам ──
  // Кто что может, решает RLS: наставник пишет только к сделкам своих учеников,
  // правит только свои комментарии.

  /** Все комментарии к сделке (по времени). Поле mentorId — чтобы UI разрешал править только свои. */
  async listComments(tradeId) {
    const rows = unwrap(await this.client.from('trade_comments').select('*').eq('trade_id', tradeId).order('created_at', { ascending: true }));
    return rows.map(snakeToCamel);
  }

  async addComment(tradeId, text) {
    const comment = cleanComment(text);
    const mentorId = await this._uid();
    const row = unwrap(
      await this.client.from('trade_comments').insert({ trade_id: tradeId, mentor_id: mentorId, comment }).select().single(),
    );
    return snakeToCamel(row);
  }

  async updateComment(commentId, text) {
    const comment = cleanComment(text);
    const mentorId = await this._uid();
    const rows = unwrap(
      await this.client.from('trade_comments').update({ comment }).eq('id', commentId).eq('mentor_id', mentorId).select(),
    );
    if (!rows.length) throw new Error('Комментарий не найден или принадлежит другому наставнику');
    return snakeToCamel(rows[0]);
  }
}
