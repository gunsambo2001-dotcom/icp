// Кабинет наставника: список учеников, карточка ученика (данные только для чтения)
// и комментарии наставника к сделкам — единственное, что наставник может записать.
// Подключается из app.js, только если main.js передал mentorStore (роль mentor/admin) —
// у ученика этого экрана нет, а данные всё равно закрыты RLS в БД.
//
// Статистика — существующий computeStats (через summarizeStudent), новых показателей нет.
// Всё, что ввёл ученик (имя, пара, стратегия…), выводится через h()/text либо esc():
// эти данные открывает наставник, им нельзя доверять.

import { computeStats, openTradePrices } from '../calc/index.js';
import { computeTradeResult } from '../calc/trade.js';
import { summarizeStudent } from '../store/mentor-store.js';
import { h, mount } from './dom.js';
import { equityChart } from './charts.js';
import * as F from './format.js';

const STATUS_LABEL = { paused: 'на паузе', archived: 'в архиве' };
const nameOf = (student) => (student.displayName || '').trim() || 'Без имени';

/**
 * @param {import('../store/mentor-store.js').MentorStore} store
 * @param {{ $main: HTMLElement, tile: Function, pageHead: Function, tradesTable: Function,
 *           showTradeCard: Function, toast: Function, isActive: () => boolean }} kit — помощники app.js
 */
export function createMentorCabinet(store, kit) {
  const st = {
    rows: null, // [{ data: {student, accounts, trades, cashflows}, sum: summarizeStudent(...) }]
    loading: false,
    error: null,
    studentId: null,
    accountFilter: 'all', // 'all' | 'real' | 'demo' | <accountId>
  };

  async function load() {
    st.loading = true;
    st.error = null;
    try {
      const roster = await store.loadRoster();
      st.rows = roster.map((data) => ({ data, sum: summarizeStudent(data) }));
    } catch (e) {
      st.rows = null;
      st.error = e.message || String(e);
    } finally {
      st.loading = false;
    }
    if (kit.isActive()) render();
  }

  function reload() {
    st.rows = null;
    load();
    render();
  }

  function showRoster() {
    st.studentId = null;
  }

  function openStudent(id) {
    st.studentId = id;
    st.accountFilter = 'all';
    render();
  }

  function render() {
    if (!st.rows && !st.loading && !st.error) load(); // ставит loading синхронно, ниже уже покажется «Загрузка»
    if (st.loading && !st.rows) {
      return mount(kit.$main, kit.pageHead('Мои ученики', 'загрузка…'), h('div.card', {}, [h('div.empty-state', { text: 'Загружаю данные учеников…' })]));
    }
    if (st.error) {
      return mount(
        kit.$main,
        kit.pageHead('Мои ученики', 'не удалось загрузить'),
        h('div.card', {}, [
          h('div.empty-state', { text: `Ошибка: ${st.error}` }),
          h('div', { style: 'text-align:center;padding-bottom:18px;' }, [h('button.btn', { onclick: reload }, ['Повторить'])]),
        ]),
      );
    }
    const row = st.studentId && st.rows?.find((r) => r.data.student.id === st.studentId);
    if (row) return renderStudent(row);
    st.studentId = null;
    return renderRoster();
  }

  // ───────────────────────────────────────────────────────────── список ──
  function renderRoster() {
    const rows = st.rows;
    const head = kit.pageHead(
      'Мои ученики',
      rows.length ? `${rows.length} ${rows.length === 1 ? 'ученик' : 'учеников'} · клик по строке — карточка ученика` : 'пока никого',
      h('button.btn', { onclick: reload }, ['Обновить']),
    );
    if (!rows.length) {
      return mount(kit.$main, head, h('div.card', {}, [h('div.empty-state', { text: 'К вам пока не привязан ни один ученик. Ученика закрепляет администратор.' })]));
    }

    const th = (label) => h('th', { text: label });
    const tbody = h('tbody', {}, rows.map(({ data, sum }) => {
      const s = sum.stats;
      const pnlCls = s.netPnl >= 0 ? 'pos-text' : 'neg-text';
      const status = STATUS_LABEL[data.student.status];
      const tr = h('tr', { onclick: () => openStudent(data.student.id) }, [
        h('td', {}, [nameOf(data.student), status ? h('span.tag', { style: 'margin-left:8px;', text: status }) : null]),
        h('td.mono', { text: String(sum.tradesCount) }),
        h('td.mono', { class: s.closedCount ? pnlCls : '', text: s.closedCount ? F.usd(s.netPnl, { sign: true }) : '—' }),
        h('td.mono', { text: s.closedCount ? F.ratio01(s.winRate, 0) : '—' }),
        h('td.mono', { text: s.closedCount ? `${s.wins} / ${s.losses}` : '—' }),
        h('td.mono', { text: sum.lastTradeAt ? F.dateShort(sum.lastTradeAt) : '—' }),
      ]);
      return tr;
    }));
    const table = h('div.tbl-wrap', {}, [
      h('table.tbl', {}, [
        h('thead', {}, [h('tr', {}, ['Ученик', 'Сделок', 'P&L', 'Винрейт', 'Плюс / минус', 'Последняя сделка'].map(th))]),
        tbody,
      ]),
    ]);
    mount(kit.$main, head, h('div.card', {}, [
      h('div.card-head', {}, [h('span.card-title', { text: 'Ученики' }), h('span.card-note', { text: 'P&L и винрейт — по закрытым сделкам, все счета' })]),
      table,
    ]));
  }

  // ─────────────────────────────────────────────────── карточка ученика ──
  /** Данные ученика с учётом фильтра по счёту (та же логика, что в «Аналитике» ученика). */
  function filtered({ accounts, trades, cashflows }) {
    const f = st.accountFilter;
    const ids = f === 'all' ? null : new Set(accounts.filter((a) => (f === 'real' ? !a.isDemo : f === 'demo' ? a.isDemo : a.id === f)).map((a) => a.id));
    if (!ids) return { accounts, trades, cashflows };
    return {
      accounts: accounts.filter((a) => ids.has(a.id)),
      trades: trades.filter((t) => ids.has(t.accountId)),
      cashflows: cashflows.filter((c) => ids.has(c.accountId)),
    };
  }

  /** Текущий баланс одного счёта — для расчёта доходности в карточке сделки. */
  function balanceFor(data, accountId) {
    const account = data.accounts.find((a) => a.id === accountId);
    if (!account) return summarizeStudent(data).stats.equityNow;
    const trades = data.trades.filter((t) => t.accountId === accountId);
    const cashflows = data.cashflows.filter((c) => c.accountId === accountId);
    return computeStats(trades, { startingBalance: Number(account.startingBalance) || 0, cashflows, prices: openTradePrices(trades) }).equityNow;
  }

  function renderStudent({ data }) {
    const { student } = data;
    const view = filtered(data);
    const sum = summarizeStudent(view);
    const s = sum.stats;
    const netCls = s.netPnl >= 0 ? 'pos' : 'neg';

    const filterSelect = data.accounts.length > 1
      ? (() => {
          const opts = [['all', 'Все счета'], ['real', 'Только реальные'], ['demo', 'Только демо'], ...data.accounts.map((a) => [a.id, `${a.name || 'Счёт'}${a.isDemo ? ' (демо)' : ''}`])];
          const el = h('select', { style: 'padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-size:12.5px;' },
            opts.map(([v, label]) => h('option', { value: v, selected: st.accountFilter === v }, [label])));
          el.addEventListener('change', () => { st.accountFilter = el.value; render(); });
          return el;
        })()
      : null;

    const actions = h('div', { style: 'display:flex;gap:8px;align-items:center;' }, [
      filterSelect,
      h('button.btn', { onclick: () => { showRoster(); render(); } }, ['← Все ученики']),
    ]);
    const status = STATUS_LABEL[student.status];
    const head = kit.pageHead(
      `${nameOf(student)}${status ? ` · ${status}` : ''}`,
      `${sum.tradesCount} сделок · ${s.closedCount} закрытых · ${s.openCount} открытых · только чтение`,
      actions,
    );

    const kpi = h('div.grid.kpi-row', {}, [
      kit.tile('Чистый P&L', F.usd(s.netPnl, { sign: true }), { cls: netCls, hero: true, delta: `<span class="chip ${netCls}">${F.rMult(s.netR)}</span><span>за ${s.closedCount} сделок</span>` }),
      kit.tile('Винрейт', F.ratio01(s.winRate), { delta: `<span class="mono">${s.wins} / ${s.losses}</span> побед/убытков` }),
      kit.tile('Profit Factor', F.factor(s.profitFactor), { delta: 'валовая прибыль / убыток' }),
      kit.tile('Экспектанси', F.rMult(s.expectancyR), { cls: s.expectancyR >= 0 ? 'pos' : 'neg', delta: `${F.usd(s.expectancyUsd, { sign: true })} на сделку` }),
      kit.tile('Макс. просадка', `−${F.ratio01(s.maxDrawdownPct)}`, { cls: 'neg', delta: `${F.usd(-s.maxDrawdown)} от пика` }),
    ]);
    const kpi2 = h('div.grid.kpi-row.four', {}, [
      kit.tile('Баланс', F.usd(s.equityNow), { delta: `старт ${F.usd(s.startingBalance)}${s.netDepositWithdrawal ? ` · вводы/выводы ${F.usd(s.netDepositWithdrawal, { sign: true })}` : ''}` }),
      kit.tile('Средний Win', F.usd(s.avgWin, { sign: true }), { cls: 'pos', delta: `${F.rMult(s.avgWinR)} в среднем` }),
      kit.tile('Средний Loss', F.usd(-s.avgLoss), { cls: 'neg', delta: `−${s.avgLossR.toFixed(2)}R в среднем` }),
      kit.tile('Серии', `${s.maxWinStreak}↑ / ${s.maxLossStreak}↓`, { delta: 'макс. подряд в плюс / в минус' }),
    ]);

    const curve = h('div.card', { style: 'margin-bottom:14px;' }, [
      h('div.card-head', {}, [h('span.card-title', { text: 'Кривая капитала' })]),
      equityChart(s.equityCurve, s.startingBalance),
    ]);

    const enriched = view.trades.map((t) => ({ t, r: computeTradeResult(t, { prices: t.currentPrice ? { [t.symbol]: t.currentPrice } : {} }) }));
    const trades = h('div.card', {}, [
      h('div.card-head', {}, [h('span.card-title', { text: 'Сделки' }), h('span.card-note', { text: 'клик по строке — сделка (только чтение)' })]),
      kit.tradesTable(enriched, { emptyText: 'Сделок пока нет.', onOpen: (id) => openTrade(data, id) }),
    ]);

    mount(kit.$main, head, kpi, kpi2, curve, trades);
  }

  function openTrade(data, id) {
    const t = data.trades.find((x) => x.id === id);
    if (!t) return;
    kit.showTradeCard(t, { readOnly: true, balanceFor: (accountId) => balanceFor(data, accountId), extra: commentsBlock(t.id) });
  }

  // ───────────────────────────────────────────── комментарии к сделке ──
  /**
   * Блок «Комментарии наставника» внутри карточки сделки: читать все, создавать новые,
   * править только свои (так же решает RLS). Тексты — только через text/children, не html.
   */
  function commentsBlock(tradeId) {
    const box = h('div', {});
    let myId = null;
    let comments = null; // null — ещё грузим
    let error = null;
    let editingId = null;
    let editText = '';
    let busy = false;
    const draft = { text: '' }; // новый комментарий переживает перерисовки блока

    async function init() {
      error = null;
      comments = null;
      draw();
      try {
        [myId, comments] = await Promise.all([store.getMyId(), store.listComments(tradeId)]);
      } catch (e) {
        error = e.message || String(e);
      }
      draw();
    }

    /** Выполняет запись; на время запроса блокирует кнопки, ошибку показывает тостом, текст не теряется. */
    async function run(action) {
      if (busy) return;
      busy = true;
      draw();
      try {
        await action();
      } catch (e) {
        kit.toast(e.message || String(e));
      } finally {
        busy = false;
        draw();
      }
    }

    function addComment() {
      const text = draft.text.trim();
      if (!text) return kit.toast('Введите текст комментария');
      run(async () => {
        comments.push(await store.addComment(tradeId, text));
        draft.text = '';
      });
    }

    function saveEdit(comment) {
      const text = editText.trim();
      if (!text) return kit.toast('Комментарий не может быть пустым');
      run(async () => {
        const saved = await store.updateComment(comment.id, text);
        comments[comments.findIndex((c) => c.id === comment.id)] = saved;
        editingId = null;
      });
    }

    const textarea = (value, placeholder, onInput) => {
      const el = h('textarea', { rows: 3, maxlength: 4000, placeholder, disabled: busy, style: 'width:100%;' }, [value]);
      el.addEventListener('input', () => onInput(el.value));
      return el;
    };

    function commentView(c) {
      const mine = c.mentorId === myId;
      if (editingId === c.id) {
        return h('div.callout', {}, [
          textarea(editText, '', (v) => { editText = v; }),
          h('div', { style: 'display:flex;gap:8px;margin-top:8px;' }, [
            h('button.btn.btn-primary', { disabled: busy, onclick: () => saveEdit(c) }, ['Сохранить']),
            h('button.btn', { disabled: busy, onclick: () => { editingId = null; draw(); } }, ['Отмена']),
          ]),
        ]);
      }
      const edited = c.updatedAt && c.createdAt && new Date(c.updatedAt) - new Date(c.createdAt) > 1000;
      return h('div.callout', {}, [
        h('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere;', text: c.comment }),
        h('div', { style: 'font-size:11.5px;color:var(--muted);margin-top:6px;display:flex;gap:10px;align-items:center;' }, [
          h('span', { text: `${mine ? 'Вы' : 'Другой наставник'} · ${F.dateTime(c.createdAt)}` }),
          edited ? h('span.tag', { text: 'изменён' }) : null,
          mine ? h('button.btn.btn-ghost', { style: 'padding:2px 8px;font-size:11.5px;', disabled: busy, onclick: () => { editingId = c.id; editText = c.comment; draw(); } }, ['Изменить']) : null,
        ]),
      ]);
    }

    function draw() {
      let body;
      if (error) {
        body = [h('div', { style: 'color:var(--muted);font-size:12.5px;', text: `Не удалось загрузить комментарии: ${error}` }), h('button.btn', { style: 'margin-top:8px;', onclick: init }, ['Повторить'])];
      } else if (!comments) {
        body = [h('div', { style: 'color:var(--muted);font-size:12.5px;', text: 'Загружаю комментарии…' })];
      } else {
        body = [
          comments.length
            ? h('div', { style: 'display:grid;gap:8px;margin-bottom:10px;' }, comments.map(commentView))
            : h('div', { style: 'color:var(--muted);font-size:12.5px;margin-bottom:10px;', text: 'Комментариев пока нет.' }),
          textarea(draft.text, 'Комментарий к этой сделке — ученик увидит его в своей сделке', (v) => { draft.text = v; }),
          h('div', { style: 'margin-top:8px;' }, [h('button.btn.btn-primary', { disabled: busy, onclick: addComment }, ['Добавить комментарий'])]),
        ];
      }
      mount(box, h('div.section-label', { style: 'margin-bottom:8px;', text: 'Комментарии наставника' }), ...body);
    }

    init();
    return box;
  }

  return { render, showRoster };
}
