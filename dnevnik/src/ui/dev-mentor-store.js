// Поддельный MentorStore для локальной проверки кабинета наставника (dev.html) и смоук-тестов.
// Тот же интерфейс, что у настоящего src/store/mentor-store.js, но данные — три выдуманных
// ученика на демо-данных, в памяти. Ни сети, ни Supabase, ни записи куда-либо.

import { SEED_TRADES, SEED_CASHFLOWS } from '../store/seed.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

function makeStudents() {
  const acc = (id, userId, name, isDemo, startingBalance) => ({ id, userId, name, isDemo, startingBalance, currency: 'USDT' });
  const forStudent = (userId, accountId, trades) => trades.map((t) => ({ ...clone(t), id: `${userId}-${t.id}`, userId, accountId }));

  // Аня — все демо-сделки на одном реальном счёте.
  const anya = {
    student: { id: 'stu-anya', displayName: 'Аня Кузнецова', status: 'active', createdAt: '2026-09-01T10:00:00Z' },
    accounts: [acc('acc-anya', 'stu-anya', 'Основной счёт', false, 10000)],
    // у первых двух сделок — ссылки на график TradingView (вторая без https://, как мог ввести ученик)
    trades: forStudent('stu-anya', 'acc-anya', SEED_TRADES).map((t, i) => (i === 0 ? { ...t, screenshotUrls: ['https://www.tradingview.com/x/AbCdEf12/'] } : i === 1 ? { ...t, screenshotUrls: ['tradingview.com/x/GhIjKl34'] } : t)),
    cashflows: SEED_CASHFLOWS.map((c) => ({ ...clone(c), id: 'stu-anya-' + c.id, accountId: 'acc-anya' })),
  };
  // Борис — два счёта: реальный и демо (проверка фильтра по счёту).
  const boris = {
    student: { id: 'stu-boris', displayName: 'Борис Иванов', status: 'active', createdAt: '2026-09-03T10:00:00Z' },
    accounts: [acc('acc-boris-r', 'stu-boris', 'Bybit Реал', false, 2000), acc('acc-boris-d', 'stu-boris', 'BingX Демо', true, 5000)],
    trades: [
      ...forStudent('stu-boris', 'acc-boris-r', SEED_TRADES.slice(0, 2)),
      ...forStudent('stu-boris', 'acc-boris-d', SEED_TRADES.slice(2)).map((t) => ({ ...t, id: t.id + '-d' })),
    ],
    cashflows: [],
  };
  // Вера — на паузе, сделок нет (пустое состояние).
  const vera = {
    student: { id: 'stu-vera', displayName: 'Вера Петрова', status: 'paused', createdAt: '2026-09-10T10:00:00Z' },
    accounts: [acc('acc-vera', 'stu-vera', 'Основной счёт', false, 1000)],
    trades: [],
    cashflows: [],
  };
  return [anya, boris, vera];
}

/** seedComments — готовые комментарии (например, чужого наставника) для проверки интерфейса. */
export function createFakeMentorStore({ role = 'admin', seedComments = [] } = {}) {
  const roster = makeStudents();
  const comments = clone(seedComments);
  let seq = 0;
  return {
    async getMyRole() { return role; },
    async getMyId() { return 'me'; },
    async listStudents() { return roster.map((r) => clone(r.student)); },
    async loadRoster() { return clone(roster); },
    async loadStudent(id) {
      const row = roster.find((r) => r.student.id === id);
      if (!row) throw new Error('Ученик не найден или не закреплён за вами');
      return clone(row);
    },
    async listComments(tradeId) { return clone(comments.filter((c) => c.tradeId === tradeId)); },
    async addComment(tradeId, text) {
      const c = { id: 'c' + ++seq, tradeId, mentorId: 'me', comment: String(text).trim(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      comments.push(c);
      return clone(c);
    },
    async updateComment(id, text) {
      const c = comments.find((x) => x.id === id);
      if (!c) throw new Error('Комментарий не найден или принадлежит другому наставнику');
      c.comment = String(text).trim();
      c.updatedAt = new Date().toISOString();
      return clone(c);
    },
  };
}
