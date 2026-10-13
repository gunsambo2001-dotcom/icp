// R-Дневник — приложение. Оркестрация: store → calc → отрисовка.
// Вся математика — в ../calc, всё хранение — в ../store. Здесь только UI.
// Store-агностично: получает готовый store (LocalStore для демо/тестов,
// SupabaseStore для реального многопользовательского режима) через startApp().
// Кто и как аутентифицируется — решает вызывающий код (см. ui/main.js),
// не этот модуль.

import { seedStore } from '../store/seed.js';
import { computePlan, computeStats, openTradePrices } from '../calc/index.js';
import { computeTradeResult, blendedPlannedR, protectedR } from '../calc/trade.js';
import { h, mount, svgIcon, ICONS, esc, safeHttpUrl } from './dom.js';
import * as F from './format.js';
import { equityChart, dailyPnlChart, rDistChart, tradeMiniChart, hideTip } from './charts.js';
import { parseShorthand } from './shorthand.js';
import { FEATURES } from '../features.js';
import { recognizeScreenshot } from '../ocr/index.js';
import { loadBrowserImage } from '../ocr/adapters/browser-image.js';
import { createMentorCabinet } from './mentor.js';
import { studentCommentsBlock } from './student-comments.js';

let store = null;
let onLogout = null;
// Кабинет наставника — только если main.js передал mentorStore (роль mentor/admin). См. ui/mentor.js.
let mentorCabinet = null;
// Скриншот для OCR живёт только в памяти вкладки, пока открыта форма создания
// сделки — см. cleanupScreenshot() внутри openTradeForm(). closeModal() зовёт
// это на ЛЮБОМ пути закрытия модалки (Отмена/✕/Escape/клик по фону/успешное
// сохранение), поэтому храним ссылку на actual cleanup здесь, а не только в
// обработчиках конкретных кнопок — иначе Escape/клик по фону обошли бы очистку.
let activeScreenshotCleanup = null;
const state = {
  view: 'dashboard',
  settings: null,
  mentor: null, // {id, displayName} | null — наставник текущего ученика
  accounts: [],
  trades: [],
  strategies: [],
  cashflows: [],
  journal: [],
  stats: null,
  calMonth: null, // {y, m}
  tradeFilter: { q: '', dir: '', strategyId: '', session: '', status: '', outcome: '' },
  tradeSort: { key: 'date', dir: 'desc' },
  analyticsAccountFilter: 'all', // 'all' | 'real' | 'demo' | <accountId> — см. renderAnalytics
};

const $main = document.getElementById('main');
const $sidebar = document.getElementById('sidebar');
const $overlay = document.getElementById('overlay');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');

// ─────────────────────────────────────────────────────────────── bootstrap ──

/**
 * Запускает приложение на уже готовом store.
 * @param {import('../store/store-interface.js').JournalStore} givenStore
 * @param {{ onLogout?: () => void }} [opts] — onLogout показывает кнопку «Выйти» в настройках.
 */
export async function startApp(givenStore, opts = {}) {
  store = givenStore;
  onLogout = opts.onLogout ?? null;
  mentorCabinet = opts.mentorStore
    ? createMentorCabinet(opts.mentorStore, { $main, tile, pageHead, tradesTable, showTradeCard, toast, isActive: () => state.view === 'mentor' })
    : null;
  applyStoredTheme();
  if (store.isDemo) await seedStore(store); // демо-данные только для LocalStore, только если пусто
  await load();
  const now = new Date();
  state.calMonth = { y: now.getFullYear(), m: now.getMonth() };
  document.getElementById('app').removeAttribute('data-loading');
  render();
  window.addEventListener('resize', hideTip);
  window.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());
  $overlay.addEventListener('click', (e) => e.target === $overlay && closeModal());
}

async function load() {
  const [settings, accounts, trades, strategies, cashflows, journal, mentor] = await Promise.all([
    store.getSettings(),
    store.listAccounts(),
    store.listTrades(),
    store.listStrategies(),
    store.listCashflows(),
    store.listJournalEntries(),
    store.getMyMentor().catch(() => null), // плашка наставника не должна ломать запуск
  ]);
  state.settings = settings;
  state.mentor = mentor;
  state.accounts = accounts;
  state.trades = trades;
  state.strategies = strategies;
  state.cashflows = cashflows;
  state.journal = journal;
  recompute();
}

/** Общая (дашборд) статистика — всегда по всем счетам пользователя суммарно. */
function recompute() {
  const startingBalance = state.accounts.reduce((sum, a) => sum + (a.startingBalance || 0), 0);
  state.stats = computeStats(state.trades, {
    startingBalance,
    cashflows: state.cashflows,
    prices: openTradePrices(state.trades),
  });
}

/** id счетов, проходящих текущий фильтр аналитики. null = без фильтра (все счета). */
function analyticsAccountIds() {
  const f = state.analyticsAccountFilter;
  if (f === 'all') return null;
  if (f === 'real') return state.accounts.filter((a) => !a.isDemo).map((a) => a.id);
  if (f === 'demo') return state.accounts.filter((a) => a.isDemo).map((a) => a.id);
  return [f]; // конкретный accountId
}

/** Текущий баланс ОДНОГО конкретного счёта — для калькулятора в форме сделки. */
function equityForAccount(accountId) {
  const account = state.accounts.find((a) => a.id === accountId);
  if (!account) return state.stats.equityNow; // fallback, если счёт почему-то не найден
  const trades = state.trades.filter((t) => t.accountId === accountId);
  const cashflows = state.cashflows.filter((c) => c.accountId === accountId);
  return computeStats(trades, { startingBalance: account.startingBalance, cashflows, prices: openTradePrices(trades) }).equityNow;
}

/** Статистика для экрана «Аналитика» — с учётом фильтра по счёту. Не трогает state.stats (дашборд). */
function computeAnalyticsStats() {
  const ids = analyticsAccountIds();
  const trades = ids ? state.trades.filter((t) => ids.includes(t.accountId)) : state.trades;
  const cashflows = ids ? state.cashflows.filter((c) => ids.includes(c.accountId)) : state.cashflows;
  const accounts = ids ? state.accounts.filter((a) => ids.includes(a.id)) : state.accounts;
  const startingBalance = accounts.reduce((sum, a) => sum + (a.startingBalance || 0), 0);
  return computeStats(trades, { startingBalance, cashflows, prices: openTradePrices(trades) });
}

function render() {
  renderSidebar();
  hideTip();
  ({
    dashboard: renderDashboard,
    trades: renderTrades,
    calendar: renderCalendar,
    analytics: renderAnalytics,
    journal: renderJournal,
    settings: renderSettings,
    mentor: () => (mentorCabinet ? mentorCabinet.render() : renderDashboard()),
  })[state.view]();
  window.scrollTo(0, 0);
}

function go(view) {
  state.view = view;
  render();
}

// ─────────────────────────────────────────────────────────────── sidebar ──
function profileLabel() {
  if (store.isDemo) return { name: 'Локальный профиль', initials: 'АК' };
  const name = (state.settings.displayName || '').trim();
  if (!name) return { name: 'Мой профиль', initials: 'Я' };
  return { name, initials: name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() };
}

function renderSidebar() {
  const nav = [
    ['dashboard', 'Дашборд', ICONS.dashboard],
    ['trades', 'Сделки', ICONS.list],
    ['calendar', 'Календарь', ICONS.calendar],
    ['analytics', 'Аналитика', ICONS.chart],
    ['journal', 'Заметки', ICONS.note],
  ];
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const profile = profileLabel();
  mount(
    $sidebar,
    h('div.brand', {}, [
      h('div.brand-mark', { text: 'R' }),
      h('div', {}, [h('div.brand-name', { text: 'R-Дневник' }), h('div.brand-sub', { text: 'поток 2026' })]),
    ]),
    h('div.nav-label', { text: 'Журнал' }),
    ...nav.map(([id, label, icon]) =>
      h('button.nav-item', { class: state.view === id ? 'active' : '', onclick: () => go(id) }, [
        h('span', { html: svgIcon(icon) }),
        label,
      ]),
    ),
    h('button.nav-item', { onclick: () => openTradeForm() }, [h('span', { html: svgIcon(ICONS.plus) }), 'Добавить сделку']),
    ...(mentorCabinet
      ? [
          h('div.nav-label', { text: 'Наставничество' }),
          h('button.nav-item', { class: state.view === 'mentor' ? 'active' : '', onclick: () => { mentorCabinet.showRoster(); go('mentor'); } }, [
            h('span', { html: svgIcon(ICONS.list) }),
            'Мои ученики',
          ]),
        ]
      : []),
    h('div.nav-label', { text: 'Настройки' }),
    h('button.nav-item', { class: state.view === 'settings' ? 'active' : '', onclick: () => go('settings') }, [
      h('span', { html: svgIcon(ICONS.settings) }),
      'Счёт и параметры',
    ]),
    h('div.sidebar-foot', {}, [
      h('div.mini-row', {}, [
        h('button.mini-btn', { onclick: toggleTheme, title: 'Тема' }, [
          h('span', { html: svgIcon(ICONS.sun, 14) }),
          theme === 'dark' ? 'Светлая' : 'Тёмная',
        ]),
        h('button.mini-btn', { onclick: exportData, title: 'Экспорт JSON' }, [h('span', { html: svgIcon(ICONS.download, 14) })]),
        h('button.mini-btn', { onclick: importData, title: 'Импорт JSON' }, [h('span', { html: svgIcon(ICONS.upload, 14) })]),
      ]),
      h('div.who', {}, [
        h('div.avatar', { text: profile.initials }),
        h('div', {}, [
          h('div.who-name', { text: profile.name }),
          h('div.who-role', { html: `баланс <span class="mono">${F.usd(state.stats.equityNow)}</span>` }),
          state.mentor ? h('div.who-role', { text: `наставник: ${state.mentor.displayName || '—'}` }) : null,
        ]),
      ]),
    ]),
  );
}

// ─────────────────────────────────────────────────────────────── tiles ──
function tile(label, value, { cls = '', delta = '', hero = false } = {}) {
  return h(`div.tile${hero ? '.hero' : ''}`, {}, [
    h('div.tile-label', { text: label }),
    h('div.tile-value', { class: cls, html: value }),
    delta ? h('div.tile-delta', { html: delta }) : null,
  ]);
}

function pageHead(title, sub, actions) {
  return h('div.page-head', {}, [
    h('div', {}, [h('div.page-title', { text: title }), sub ? h('div.page-sub', { html: sub }) : null]),
    actions || null,
  ]);
}

const newTradeBtn = () =>
  h('button.btn.btn-primary', { onclick: () => openTradeForm() }, [h('span', { html: svgIcon(ICONS.plusLine) }), 'Новая сделка']);

// ─────────────────────────────────────────────────────────────── DASHBOARD ──
function renderDashboard() {
  const s = state.stats;
  const netCls = s.netPnl >= 0 ? 'pos' : 'neg';
  const streakTxt =
    s.currentStreak > 0 ? `${s.currentStreak} подряд в плюс` : s.currentStreak < 0 ? `${-s.currentStreak} подряд в минус` : '—';

  const kpi = h('div.grid.kpi-row', {}, [
    tile('Чистый P&L', F.usd(s.netPnl, { sign: true }), {
      cls: netCls,
      hero: true,
      delta: `<span class="chip ${netCls}">${F.rMult(s.netR)}</span><span>за ${s.closedCount} сделок</span>`,
    }),
    tile('Винрейт', F.ratio01(s.winRate), {
      delta: `<span class="mono">${s.wins} / ${s.losses}</span> побед/убытков`,
    }),
    tile('Profit Factor', F.factor(s.profitFactor), { delta: 'валовая прибыль / убыток' }),
    tile('Экспектанси', F.rMult(s.expectancyR), {
      cls: s.expectancyR >= 0 ? 'pos' : 'neg',
      delta: `${F.usd(s.expectancyUsd, { sign: true })} на сделку`,
    }),
    tile('Макс. просадка', `−${F.ratio01(s.maxDrawdownPct)}`, { cls: 'neg', delta: `${F.usd(-s.maxDrawdown)} от пика` }),
  ]);

  const kpi2 = h('div.grid.kpi-row.four', {}, [
    tile('Средний Win', F.usd(s.avgWin, { sign: true }), { cls: 'pos', delta: `${F.rMult(s.avgWinR)} в среднем` }),
    tile('Средний Loss', F.usd(-s.avgLoss), { cls: 'neg', delta: `−${s.avgLossR.toFixed(2)}R в среднем` }),
    tile('Сделок', String(s.closedCount), { delta: `${s.maxWinStreak}↑ / ${s.maxLossStreak}↓ макс. серии` }),
    tile('Текущая серия', s.currentStreak === 0 ? '—' : `${s.currentStreak > 0 ? '+' : '−'}${Math.abs(s.currentStreak)}`, {
      cls: s.currentStreak >= 0 ? 'pos' : 'neg',
      delta: streakTxt,
    }),
  ]);

  const mid = h('div.grid.dash-mid', {}, [
    h('div.card', {}, [
      h('div.card-head', {}, [
        h('span.card-title', { text: 'Кривая капитала' }),
        h('span.card-note', {
          html: `старт ${F.usd(s.startingBalance)}${s.netDepositWithdrawal ? ` · вводы/выводы ${F.usd(s.netDepositWithdrawal, { sign: true })}` : ''} · сейчас <span class="mono">${F.usd(s.equityNow)}</span>`,
        }),
      ]),
      equityChart(s.equityCurve.map((p) => ({ ...p, trade: p.date && findTradeByClose(p.date, p.equity) })), s.startingBalance),
    ]),
    h('div.card', {}, [
      h('div.card-head', {}, [h('span.card-title', { text: 'Открытые позиции' }), h('span.card-note', { text: `${s.openCount} активны` })]),
      s.openPositions.length
        ? h('div', {}, s.openPositions.map(openPosRow))
        : h('div.empty-state', { text: 'Открытых позиций нет' }),
    ]),
  ]);

  const daily = h('div.card', { style: 'margin-bottom:14px;' }, [
    h('div.card-head', {}, [
      h('span.card-title', { text: 'P&L по дням' }),
      h('span.legend', {
        html: `<span><i style="background:var(--profit)"></i>прибыльный</span><span><i style="background:var(--loss)"></i>убыточный</span>`,
      }),
    ]),
    dailyPnlChart(s.dailyPnl),
  ]);

  const recent = h('div.card', {}, [
    h('div.card-head', {}, [
      h('span.card-title', { text: 'Последние сделки' }),
      h('button.card-note', { onclick: () => go('trades') }, ['Все сделки →']),
    ]),
    tradesTable(state.trades.slice().reverse().slice(0, 7).map(enrichTrade), { emptyText: 'Сделок пока нет. Добавьте первую.' }),
  ]);

  mount($main, pageHead('Дашборд', `${s.closedCount} закрытых · ${s.openCount} открытых`, newTradeBtn()), kpi, kpi2, mid, daily, recent);
}

function findTradeByClose(date) {
  // для тултипа кривой: сделка, закрытая в этот момент (приблизительно по дате)
  const r = state.stats.tradeResults.find((res) => {
    const t = state.trades.find((x) => x.id === res.tradeId);
    return t && (t.closedAt || t.openedAt) === date;
  });
  if (!r) return null;
  const t = state.trades.find((x) => x.id === r.tradeId);
  return { symbol: t.symbol, pnl: r.pnl, rMultiple: r.rMultiple };
}

function openPosRow(p) {
  const t = p.trade;
  return h('div', { style: 'padding:11px 0;border-bottom:1px solid var(--border);cursor:pointer;', onclick: () => openTradeCard(t.id) }, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;' }, [
      h('span', { html: `<b>${t.symbol}</b> <span class="dir ${t.direction}">${F.DIRECTION_LABEL[t.direction]}</span>` }),
      h('span.mono', { class: p.pnl >= 0 ? 'pos-text' : 'neg-text', style: 'font-weight:600;', text: t.currentPrice ? F.usd(p.pnl, { sign: true }) : '—' }),
    ]),
    h('div.mono', {
      style: 'font-size:11.5px;color:var(--ink-2);',
      text: `вход ${F.num(t.entry)} · стоп ${F.num(p.workingStop)}${p.movedToBreakeven ? ' (БУ)' : ''}${t.tp3 || t.target ? ` · TP3 ${F.num(t.tp3 ?? t.target)}` : ''}${t.currentPrice ? ` · тек. ${F.num(t.currentPrice)}` : ''}`,
    }),
    h('div', {
      style: 'font-size:11px;color:var(--muted);margin-top:3px;',
      text: `${p.closedSize > 0 ? `закрыто ${F.num(p.closedSize)} из ${F.num(p.totalSize)} · ` : ''}${t.currentPrice ? `нереализованный · ${F.rMult(p.rMultiple)}` : 'укажите текущую цену для нереализованного P&L'}`,
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────── TRADES ──
function enrichTrade(t) {
  return { t, r: computeTradeResult(t, { prices: t.currentPrice ? { [t.symbol]: t.currentPrice } : {} }) };
}

function filteredSortedTrades() {
  const f = state.tradeFilter;
  let list = state.trades.map(enrichTrade);
  if (f.q) list = list.filter(({ t }) => t.symbol.toLowerCase().includes(f.q.toLowerCase()));
  if (f.dir) list = list.filter(({ t }) => t.direction === f.dir);
  if (f.strategyId) list = list.filter(({ t }) => (t.strategyId || '') === f.strategyId);
  if (f.session) list = list.filter(({ t }) => (t.session || '') === f.session);
  if (f.status === 'open') list = list.filter(({ r }) => r.isOpen);
  if (f.status === 'closed') list = list.filter(({ r }) => !r.isOpen);
  if (f.outcome === 'win') list = list.filter(({ r }) => r.isWin);
  if (f.outcome === 'loss') list = list.filter(({ r }) => r.isLoss);

  const { key, dir } = state.tradeSort;
  const val = ({ t, r }) => ({
    date: new Date(t.openedAt).getTime(),
    symbol: t.symbol,
    pnl: r.isOpen ? -Infinity : r.pnl,
    r: r.isOpen ? -Infinity : r.rMultiple,
    rr: r.rrPlanned || 0,
  })[key];
  list.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return dir === 'asc' ? c : -c;
  });
  return list;
}

// onOpen(id) — что делать по клику на строку; по умолчанию открывает карточку своей сделки.
function tradesTable(enriched, { sortable = false, emptyText = 'Ничего не найдено по фильтру.', onOpen = openTradeCard } = {}) {
  if (!enriched.length) return h('div.empty-state', { text: emptyText });
  const rows = enriched
    .map(({ t, r }) => {
      const pnlCls = r.isOpen ? '' : r.pnl >= 0 ? 'pos-text' : 'neg-text';
      const rCls = r.rMultiple >= 0 ? 'pos' : 'neg';
      return `<tr data-id="${esc(t.id)}">
        <td><span class="status-dot ${r.isOpen ? 'open' : 'closed'}"></span>${F.dateShort(t.openedAt)}</td>
        <td>${esc(t.symbol)}</td>
        <td><span class="dir ${esc(t.direction)}">${esc(F.DIRECTION_LABEL[t.direction])}</span></td>
        <td>${t.strategyName ? `<span class="tag">${esc(t.strategyName)}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td class="mono">${F.num(t.entry)}</td>
        <td class="mono">${r.avgExit != null ? F.num(r.avgExit) + (r.isOpen ? '*' : '') : '—'}</td>
        <td class="mono">${r.rrPlanned ? r.rrPlanned.toFixed(1) : '—'}</td>
        <td class="mono ${pnlCls}">${r.isOpen ? '<span style="color:var(--accent)">открыта</span>' : F.usd(r.pnl, { sign: true })}</td>
        <td style="text-align:right;">${r.isOpen ? '—' : `<span class="r-pill ${rCls}">${F.rMult(r.rMultiple)}</span>`}</td>
      </tr>`;
    })
    .join('');
  const cols = [
    ['date', 'Дата'], ['symbol', 'Пара'], [null, 'Напр.'], [null, 'Стратегия'],
    [null, 'Вход'], [null, 'Выход'], ['rr', 'RR'], ['pnl', 'P&L'], ['r', 'R'],
  ];
  const arrow = (k) => (state.tradeSort.key === k ? (state.tradeSort.dir === 'asc' ? ' ↑' : ' ↓') : '');
  const thead = cols
    .map(([k, label]) =>
      sortable && k
        ? `<th data-sort="${k}" style="cursor:pointer;user-select:none;">${label}${arrow(k)}</th>`
        : `<th>${label}</th>`,
    )
    .join('');
  const table = h('div.tbl-wrap', {
    html: `<table class="tbl"><thead><tr>${thead}</tr></thead><tbody>${rows}</tbody></table>`,
  });
  table.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => onOpen(tr.dataset.id)));
  table.querySelectorAll('th[data-sort]').forEach((th) =>
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.tradeSort.key === k) state.tradeSort.dir = state.tradeSort.dir === 'asc' ? 'desc' : 'asc';
      else state.tradeSort = { key: k, dir: k === 'symbol' ? 'asc' : 'desc' };
      renderTrades();
    }),
  );
  return table;
}

function renderTrades() {
  const s = state.stats;
  const f = state.tradeFilter;
  const enriched = filteredSortedTrades();

  const sel = (key, opts, placeholder) => {
    const el = h('select', { style: 'padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-size:12.5px;' },
      [h('option', { value: '' }, [placeholder]), ...opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, [l]))]);
    el.addEventListener('change', () => { f[key] = el.value; renderTrades(); });
    return el;
  };
  const search = h('input', {
    placeholder: 'Поиск по паре…', value: f.q,
    style: 'padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-size:12.5px;min-width:150px;',
  });
  search.addEventListener('input', () => { f.q = search.value; refreshTradesBody(); });

  const filterRow = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;align-items:center;' }, [
    search,
    sel('dir', [['long', 'LONG'], ['short', 'SHORT']], 'Направление'),
    sel('strategyId', state.strategies.map((x) => [x.id, x.name]), 'Стратегия'),
    sel('session', [['asia', 'Азия'], ['london', 'Лондон'], ['newyork', 'Нью-Йорк']], 'Сессия'),
    sel('status', [['open', 'Открытые'], ['closed', 'Закрытые']], 'Статус'),
    sel('outcome', [['win', 'Прибыльные'], ['loss', 'Убыточные']], 'Результат'),
    (f.q || f.dir || f.strategyId || f.session || f.status || f.outcome)
      ? h('button.btn.btn-ghost', { style: 'font-size:12px;padding:6px 10px;', onclick: () => { state.tradeFilter = { q: '', dir: '', strategyId: '', session: '', status: '', outcome: '' }; renderTrades(); } }, ['Сбросить'])
      : null,
  ]);

  const bodyWrap = h('div', { id: 'trades-body' }, [tradesTable(enriched, { sortable: true })]);
  // мгновенное обновление при поиске без перерисовки фильтров (чтобы фокус не терялся)
  _refreshTradesBody = () => mount(bodyWrap, tradesTable(filteredSortedTrades(), { sortable: true }));

  mount(
    $main,
    pageHead('Сделки', `${state.trades.length} записей · показано ${enriched.length} · чистый ${F.usd(s.netPnl, { sign: true })}`, newTradeBtn()),
    h('div.card', {}, [
      h('div.card-head', {}, [
        h('span.card-title', { text: 'Сделки' }),
        h('span.card-note', { text: 'клик по строке — карточка · клик по заголовку — сортировка' }),
      ]),
      filterRow,
      bodyWrap,
    ]),
  );
}
let _refreshTradesBody = null;
function refreshTradesBody() {
  if (_refreshTradesBody) _refreshTradesBody();
}

// ─────────────────────────────────────────────────────────────── CALENDAR ──
function renderCalendar() {
  const { y, m } = state.calMonth;
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, m + 1, 0).getDate();

  const dmap = {};
  for (const r of state.stats.tradeResults) {
    const t = state.trades.find((x) => x.id === r.tradeId);
    const d = new Date(t.closedAt || t.openedAt);
    if (d.getFullYear() === y && d.getMonth() === m) {
      const k = d.getDate();
      (dmap[k] ||= { pnl: 0, n: 0 });
      dmap[k].pnl += r.pnl;
      dmap[k].n++;
    }
  }
  const monthResults = Object.values(dmap);
  const mPnl = monthResults.reduce((a, b) => a + b.pnl, 0);
  const mN = monthResults.reduce((a, b) => a + b.n, 0);
  const mWins = state.stats.tradeResults.filter((r) => {
    const t = state.trades.find((x) => x.id === r.tradeId);
    const d = new Date(t.closedAt || t.openedAt);
    return d.getFullYear() === y && d.getMonth() === m && r.pnl > 0;
  }).length;

  const kpi = h('div.grid.kpi-row.four', { style: 'margin-bottom:16px;' }, [
    tile('P&L месяца', F.usd(mPnl, { sign: true }), { cls: mPnl >= 0 ? 'pos' : 'neg' }),
    tile('Сделок', String(mN)),
    tile('Винрейт месяца', mN ? F.ratio01(mWins / mN) : '—'),
    tile('Лучший день', monthResults.length ? F.usd(Math.max(...monthResults.map((r) => r.pnl)), { sign: true }) : '—', {
      cls: 'pos',
    }),
  ]);

  const dows = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const grid = h('div.cal', {}, [
    ...dows.map((d) => h('div.cal-dow', { text: d })),
    h('div.cal-dow.wk', { text: 'Неделя' }),
  ]);

  for (let w = 0; w < cells.length / 7; w++) {
    let wp = 0;
    let wn = 0;
    for (let i = 0; i < 7; i++) {
      const d = cells[w * 7 + i];
      if (d == null) {
        grid.appendChild(h('div.cal-cell.empty'));
        continue;
      }
      const info = dmap[d];
      if (info) {
        wp += info.pnl;
        wn += info.n;
        grid.appendChild(
          h(`div.cal-cell.${info.pnl >= 0 ? 'win' : 'loss'}`, {}, [
            h('span.cal-day', { text: d }),
            h('span.cal-pnl', { class: info.pnl >= 0 ? 'pos-text' : 'neg-text', text: F.usd(info.pnl, { sign: true }) }),
            h('span.cal-meta', { text: `${info.n} сд.` }),
          ]),
        );
      } else {
        grid.appendChild(h('div.cal-cell', {}, [h('span.cal-day', { text: d })]));
      }
    }
    grid.appendChild(
      h('div.cal-week', {}, [
        h('span.w-label', { text: `Нед. ${w + 1}` }),
        h('span.w-val', { class: wn ? (wp >= 0 ? 'pos-text' : 'neg-text') : '', text: wn ? F.usd(wp, { sign: true }) : '—' }),
        h('span.w-label', { text: `${wn} сд.` }),
      ]),
    );
  }

  const navBtns = h('div.cal-nav', {}, [
    h('button', { onclick: () => shiftMonth(-1), html: svgIcon(ICONS.left, 15), 'aria-label': 'Предыдущий месяц' }),
    h('span.mono', { style: 'font-weight:600;min-width:130px;text-align:center;', text: `${F.MONTHS_FULL[m]} ${y}` }),
    h('button', { onclick: () => shiftMonth(1), html: svgIcon(ICONS.right, 15), 'aria-label': 'Следующий месяц' }),
  ]);

  mount($main, pageHead('Торговый календарь', `${mN} сделок · ${monthResults.length} торговых дней`, navBtns), kpi, h('div.card', {}, [grid]));
}
function shiftMonth(delta) {
  let { y, m } = state.calMonth;
  m += delta;
  if (m < 0) {
    m = 11;
    y--;
  } else if (m > 11) {
    m = 0;
    y++;
  }
  state.calMonth = { y, m };
  renderCalendar();
}

// ─────────────────────────────────────────────────────────────── ANALYTICS ──
function hbarList(map, { labelFn = (k) => k, showWr = false } = {}) {
  const rows = Object.entries(map).map(([k, v]) => ({ k, ...v }));
  if (!rows.length) return h('div.empty-state', { text: 'Нет данных' });
  rows.sort((a, b) => b.netPnl - a.netPnl);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.netPnl))) || 1;
  return h(
    'div',
    {},
    rows.map((r) =>
      h('div.hbar', {}, [
        h('span.hbar-name', { title: labelFn(r.k), text: labelFn(r.k) }),
        h('span.hbar-track', {}, [
          h('span.hbar-fill', {
            style: `width:${(Math.abs(r.netPnl) / maxAbs) * 100}%;background:${r.netPnl >= 0 ? 'var(--profit)' : 'var(--loss)'};`,
          }),
        ]),
        h('span.hbar-val', {
          class: r.netPnl >= 0 ? 'pos-text' : 'neg-text',
          html: `${F.usd(r.netPnl, { sign: true })} <span class="muted">· ${showWr ? `${Math.round(r.winRate * 100)}% · ` : ''}${r.count}</span>`,
        }),
      ]),
    ),
  );
}

function renderAnalytics() {
  const s = computeAnalyticsStats();
  const buckets = s.tradeResults.length
    ? bucketize(s.tradeResults)
    : [];

  const filterRow = accountFilterRow();

  const sideBlock = (label, st) =>
    h('div', { style: 'flex:1;display:flex;flex-direction:column;gap:6px;' }, [
      h('div.section-label', { text: `${label} · ${st.count}` }),
      h('div.mono', { class: st.netPnl >= 0 ? 'pos-text' : 'neg-text', style: 'font-size:20px;font-weight:600;', text: F.usd(st.netPnl, { sign: true }) }),
      h('div', { style: 'font-size:12px;color:var(--ink-2);', text: `винрейт ${F.ratio01(st.winRate)} · ${F.rMult(st.netR)}` }),
      h('div.meter', { style: `background:color-mix(in srgb, ${st.netPnl >= 0 ? 'var(--profit)' : 'var(--loss)'} 22%, transparent);` }, [
        h('i', { style: `width:${st.winRate * 100}%;background:${st.netPnl >= 0 ? 'var(--profit)' : 'var(--loss)'};` }),
      ]),
    ]);

  mount(
    $main,
    pageHead('Аналитика', 'Все расчёты — программная логика по вашим сделкам, без AI.'),
    filterRow,
    h('div.grid.two-col', { style: 'margin-bottom:14px;' }, [
      h('div.card', {}, [
        h('div.card-head', {}, [h('span.card-title', { text: 'Распределение R-мультипликаторов' }), h('span.card-note', { text: 'закрытые сделки' })]),
        buckets.length ? rDistChart(buckets) : h('div.empty-state', { text: 'Нет закрытых сделок' }),
        h('div.hint', { style: 'margin-top:8px;', text: `С частичной фиксацией: ${s.withPartials} · с переводом в безубыток: ${s.withBreakeven} · из них вышли в БУ: ${s.breakevenExits}` }),
      ]),
      h('div.card', {}, [
        h('div.card-head', {}, [h('span.card-title', { text: 'Long / Short' })]),
        h('div', { style: 'display:flex;gap:22px;' }, [
          sideBlock('LONG', s.long),
          h('div', { style: 'width:1px;background:var(--border);' }),
          sideBlock('SHORT', s.short),
        ]),
      ]),
    ]),
    h('div.grid.two-col', { style: 'margin-bottom:14px;' }, [
      card('По торговым парам', hbarList(s.bySymbol)),
      card('По стратегиям', hbarList(s.byStrategy, { showWr: true })),
    ]),
    h('div.grid.two-col', {}, [
      card('По сессиям', hbarList(s.bySession, { labelFn: (k) => F.SESSION_LABEL[k] || k, showWr: true })),
      card('По дням недели', hbarList(s.byWeekday, { labelFn: (k) => F.WEEKDAYS_SHORT[+k], showWr: true })),
    ]),
  );
}
/** Строка фильтра по счёту для «Аналитики». Скрыта, пока счёт всего один. */
function accountFilterRow() {
  if (state.accounts.length <= 1) return null;
  const hasReal = state.accounts.some((a) => !a.isDemo);
  const hasDemo = state.accounts.some((a) => a.isDemo);
  const options = [
    ['all', 'Все счета'],
    ...(hasReal ? [['real', 'Только реальные']] : []),
    ...(hasDemo ? [['demo', 'Только демо']] : []),
    ...state.accounts.map((a) => [a.id, a.name]),
  ];
  const el = h('select', {
    style: 'padding:7px 9px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-size:12.5px;',
  }, options.map(([v, l]) => h('option', { value: v, selected: state.analyticsAccountFilter === v }, [l])));
  el.addEventListener('change', () => { state.analyticsAccountFilter = el.value; renderAnalytics(); });
  return h('div', { style: 'margin-bottom:14px;' }, [el]);
}
function card(title, body) {
  return h('div.card', {}, [h('div.card-head', {}, [h('span.card-title', { text: title })]), body]);
}
function bucketize(results) {
  const defs = [
    { label: '≤ −1R', test: (r) => r <= -1, isWin: false },
    { label: '−1…0', test: (r) => r > -1 && r <= 0, isWin: false },
    { label: '0…1R', test: (r) => r > 0 && r <= 1, isWin: true },
    { label: '1…2R', test: (r) => r > 1 && r <= 2, isWin: true },
    { label: '2…3R', test: (r) => r > 2 && r <= 3, isWin: true },
    { label: '≥ 3R', test: (r) => r > 3, isWin: true },
  ];
  return defs.map((d) => ({ label: d.label, isWin: d.isWin, n: results.filter((x) => d.test(x.rMultiple)).length }));
}

// ─────────────────────────────────────────────────────────────── JOURNAL ──
function mondayOf(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Статистика за неделю [monday, monday+7) — для шаблона обзора. */
function weekStats(monday) {
  const start = new Date(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 7);
  const inWeek = state.trades.filter((t) => {
    const r = computeTradeResult(t, {});
    const d = new Date(r.closedAt || t.closedAt || t.openedAt);
    return d >= start && d < end && !r.isOpen;
  });
  const results = inWeek.map((t) => computeTradeResult(t, {}));
  const wins = results.filter((r) => r.pnl > 0).length;
  const net = results.reduce((s, r) => s + r.pnl, 0);
  const netR = results.reduce((s, r) => s + r.rMultiple, 0);
  return { count: results.length, wins, net, netR, winRate: results.length ? wins / results.length : 0 };
}

function weeklyTemplate(monday) {
  const w = weekStats(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  const period = `${F.dateShort(monday.toISOString())} – ${F.dateShort(end.toISOString())}`;
  return [
    `Обзор недели ${period}`,
    '',
    `Статистика: ${w.count} сделок · винрейт ${(w.winRate * 100).toFixed(0)}% · P&L ${w.net >= 0 ? '+' : '−'}$${Math.abs(Math.round(w.net))} · ${w.netR >= 0 ? '+' : '−'}${Math.abs(w.netR).toFixed(2)}R`,
    '',
    'Что получилось:',
    '- ',
    '',
    'Ошибки и нарушения правил:',
    '- ',
    '',
    'Соблюдение чек-листа входа:',
    '- ',
    '',
    'Психология / состояние:',
    '- ',
    '',
    'План на следующую неделю:',
    '- ',
  ].join('\n');
}

function renderJournal() {
  const entries = state.journal.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const actions = h('div', { style: 'display:flex;gap:8px;' }, [
    h('button.btn', { onclick: () => openJournalEditor(null, 'note') }, [h('span', { html: svgIcon(ICONS.plusLine) }), 'Заметка']),
    h('button.btn.btn-primary', { onclick: () => openJournalEditor(null, 'weekly') }, [h('span', { html: svgIcon(ICONS.plusLine) }), 'Еженедельный обзор']),
  ]);

  mount(
    $main,
    pageHead('Заметки и обзоры', 'Свободные записи и еженедельный разбор торговли.', actions),
    entries.length
      ? h('div.grid', { style: 'gap:12px;' }, entries.map((e) =>
          h('div.card', { style: 'cursor:pointer;', onclick: () => openJournalEditor(e.id) }, [
            h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px;' }, [
              h('span', { style: 'font-weight:600;font-size:14px;', html: `${e.type === 'weekly' ? '<span class="tag">обзор</span> ' : ''}${escapeText(e.title) || '(без заголовка)'}` }),
              h('span.card-note', { text: F.dateTime(e.createdAt) }),
            ]),
            h('div', { style: 'font-size:12.5px;color:var(--ink-2);white-space:pre-wrap;max-height:64px;overflow:hidden;', text: e.body.slice(0, 260) }),
          ]),
        ))
      : h('div.card', {}, [h('div.empty-state', { text: 'Записей пока нет. Начните с еженедельного обзора.' })]),
  );
}

function openJournalEditor(id, newType) {
  const editing = id ? state.journal.find((e) => e.id === id) : null;
  const type = editing?.type || newType || 'note';
  const monday = mondayOf();
  const draft = editing
    ? { ...editing }
    : {
        type,
        title: type === 'weekly' ? `Обзор недели ${F.dateShort(monday.toISOString())}` : '',
        body: type === 'weekly' ? weeklyTemplate(monday) : '',
        weekOf: type === 'weekly' ? monday.toISOString() : undefined,
      };

  const titleInp = h('input', { value: draft.title, placeholder: 'Заголовок', style: 'width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);' });
  const bodyInp = h('textarea', { rows: 16, style: 'width:100%;padding:11px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);color:var(--ink);font-family:inherit;line-height:1.55;resize:vertical;' }, [draft.body]);
  titleInp.addEventListener('input', () => { draft.title = titleInp.value; });
  bodyInp.addEventListener('input', () => { draft.body = bodyInp.value; });

  openModal(
    h('div', {}, [
      h('div.modal-head', {}, [
        h('h2', { style: 'font-size:17px;', text: editing ? 'Редактирование записи' : type === 'weekly' ? 'Еженедельный обзор' : 'Новая заметка' }),
        h('button.modal-close', { onclick: closeModal, text: '✕' }),
      ]),
      h('div.modal-body', {}, [titleInp, bodyInp]),
      h('div.modal-foot', {}, [
        editing
          ? h('button.btn.btn-danger', { onclick: () => confirmModal('Удалить запись?', async () => { await store.deleteJournalEntry(editing.id); await load(); render(); toast('Запись удалена'); }) }, [h('span', { html: svgIcon(ICONS.trash, 14) }), 'Удалить'])
          : h('span'),
        h('div', { style: 'display:flex;gap:8px;' }, [
          h('button.btn.btn-ghost', { onclick: closeModal }, ['Отмена']),
          h('button.btn.btn-primary', { onclick: async () => {
            if (editing) await store.updateJournalEntry(editing.id, { title: draft.title, body: draft.body });
            else await store.createJournalEntry({ type: draft.type, title: draft.title, body: draft.body, weekOf: draft.weekOf });
            await load();
            closeModal();
            render();
            toast('Сохранено');
          } }, [h('span', { html: svgIcon(ICONS.check) }), 'Сохранить']),
        ]),
      ]),
    ]),
  );
}
function escapeText(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ─────────────────────────────────────────────────────────────── SETTINGS ──
function renderSettings() {
  const st = state.settings;
  const field = (label, id, value, attrs = {}) =>
    h('div.field', {}, [
      h('label', { for: id, text: label }),
      h('input.mono', { id, value, ...attrs }),
    ]);

  const saveBtn = h('button.btn.btn-primary', { onclick: saveSettings }, [h('span', { html: svgIcon(ICONS.check) }), 'Сохранить параметры']);

  const cashRows = state.cashflows.length
    ? state.cashflows
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((c) =>
          h('div.row-item', {}, [
            h('span', { html: `<span class="tag">${c.type === 'deposit' ? 'депозит' : 'вывод'}</span> ${F.dateShort(c.date)}${c.note ? ` · ${c.note}` : ''}` }),
            h('span', { style: 'display:flex;gap:10px;align-items:center;' }, [
              h('span.mono', { class: c.type === 'deposit' ? 'pos-text' : 'neg-text', text: `${c.type === 'deposit' ? '+' : '−'}${F.usd(c.amount)}` }),
              h('button.btn.btn-ghost', { onclick: () => removeCashflow(c.id), html: svgIcon(ICONS.trash, 13), 'aria-label': 'Удалить' }),
            ]),
          ]),
        )
    : [h('div.empty-state', { text: 'Движений средств нет' })];

  mount(
    $main,
    pageHead('Счёт и параметры', 'Влияют на баланс, расчёт размера позиции и статистику.'),
    h('div.grid.two-col', {}, [
      h('div.card', {}, [
        h('div.card-head', {}, [h('span.card-title', { text: 'Основные' })]),
        store.isDemo ? null : h('div.field', { style: 'margin-bottom:12px;' }, [
          h('label', { for: 'set-name', text: 'Ваше имя' }),
          h('input', { id: 'set-name', value: st.displayName || '', maxlength: 100, placeholder: 'Имя и фамилия' }),
          h('div.hint', { text: 'Так вас видит наставник.' }),
        ]),
        h('div.form-grid', {}, [
          field('Стартовый баланс, $', 'set-balance', st.startingBalance, { type: 'number', step: '0.01' }),
          field('Базовая валюта', 'set-currency', st.baseCurrency),
          FEATURES.positionCalc ? field('Риск на сделку по умолчанию, %', 'set-risk', st.defaultRiskPct, { type: 'number', step: '0.1' }) : null,
          field('Плечо по умолчанию', 'set-lev', st.defaultLeverage, { type: 'number', step: '1' }),
          field('Комиссия (тейкер), % за сторону', 'set-comm', st.commissionRatePct, { type: 'number', step: '0.01' }),
          field('Проскальзывание по умолчанию, %', 'set-slip', st.defaultSlippagePct, { type: 'number', step: '0.01' }),
          field('Фиксация на TP1 по умолчанию, %', 'set-tp1', st.tp1ClosePct, { type: 'number', step: '1' }),
          field('Фиксация на TP2 по умолчанию, %', 'set-tp2', st.tp2ClosePct, { type: 'number', step: '1' }),
          field('Буфер безубытка по умолчанию (цена)', 'set-bebuf', st.beBuffer, { type: 'number', step: 'any' }),
        ]),
        h('div.field', { style: 'margin-top:10px;' }, [
          h('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer;' }, [
            h('input', { type: 'checkbox', id: 'set-beflag', checked: !!st.breakevenAfterTp1 }),
            'После TP1 переносить стоп в безубыток (по умолчанию)',
          ]),
        ]),
        h('div', { style: 'margin-top:14px;' }, [saveBtn]),
      ]),
      h('div.card', {}, [
        h('div.card-head', {}, [
          h('span.card-title', { text: 'Депозиты и выводы' }),
          h('button.card-note', { onclick: addCashflow }, ['+ Добавить']),
        ]),
        h('div.row-list', {}, cashRows),
      ]),
    ]),
    state.mentor
      ? h('div.card', { style: 'margin-top:14px;' }, [
          h('div.card-head', {}, [h('span.card-title', { text: 'Ваш наставник' })]),
          h('div', { style: 'font-size:14px;font-weight:600;margin-bottom:6px;', text: state.mentor.displayName || 'Без имени' }),
          h('div', {
            style: 'font-size:12.5px;color:var(--ink-2);',
            text: 'Наставник видит ваши сделки, счета, движения средств и статистику и может оставлять комментарии к сделкам. Ваши личные заметки и недельные разборы ему недоступны.',
          }),
        ])
      : null,
    h('div.card', { style: 'margin-top:14px;' }, [
      h('div.card-head', {}, [
        h('span.card-title', { text: 'Счета' }),
        h('button.card-note', { onclick: addAccount }, ['+ Добавить счёт']),
      ]),
      h('div.row-list', {}, state.accounts.map((a) =>
        h('div.row-item', {}, [
          h('span', { html: `<b>${escapeText(a.name)}</b>${a.exchange ? ` <span class="tag">${escapeText(a.exchange)}</span>` : ''}${a.isDemo ? ' <span class="tag">демо</span>' : ''}` }),
          h('span', { style: 'display:flex;gap:10px;align-items:center;' }, [
            h('span.mono', { text: `${F.usd(a.startingBalance)} ${a.currency}` }),
            state.accounts.length > 1
              ? h('button.btn.btn-ghost', { onclick: () => removeAccount(a), html: svgIcon(ICONS.trash, 13), 'aria-label': 'Удалить счёт' })
              : null,
          ]),
        ]),
      )),
    ]),
    h('div.card', { style: 'margin-top:14px;' }, [
      h('div.card-head', {}, [
        h('span.card-title', { text: 'Стратегии / сетапы' }),
        h('button.card-note', { onclick: addStrategy }, ['+ Добавить']),
      ]),
      state.strategies.length
        ? h('div.row-list', {}, state.strategies.map((s) =>
            h('div.row-item', {}, [
              h('span', { html: `<b>${s.name}</b>${s.moduleRef ? ` <span class="tag">${s.moduleRef}</span>` : ''}` }),
            ]),
          ))
        : h('div.empty-state', { text: 'Стратегий нет' }),
    ]),
    h('div.card', { style: 'margin-top:14px;' }, [
      h('div.card-head', {}, [h('span.card-title', { text: 'Данные' })]),
      h('div', {
        style: 'font-size:12.5px;color:var(--ink-2);margin-bottom:12px;',
        html: store.isDemo
          ? '<b>Хранятся только в этом браузере</b> (LocalStorage). Экспортируйте JSON для переноса.'
          : '<b>Хранятся в вашем аккаунте</b> (Supabase), доступны с любого устройства после входа.',
      }),
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;' }, [
        h('button.btn', { onclick: exportData }, [h('span', { html: svgIcon(ICONS.download) }), 'Экспорт JSON']),
        h('button.btn', { onclick: importData }, [h('span', { html: svgIcon(ICONS.upload) }), 'Импорт JSON']),
        store.isDemo
          ? h('button.btn.btn-danger', { onclick: resetData }, [h('span', { html: svgIcon(ICONS.trash) }), 'Сбросить к демо-данным'])
          : null,
        onLogout
          ? h('button.btn', { onclick: onLogout }, [h('span', { html: svgIcon(ICONS.logout) }), 'Выйти'])
          : null,
      ]),
    ]),
  );
}

function resetData() {
  confirmModal('Удалить все сделки, настройки, движения средств и заметки, вернуть демо-данные?', async () => {
    await store.clearAll();
    await seedStore(store);
    await load();
    render();
    toast('Данные сброшены к демо');
  }, { confirmLabel: 'Сбросить' });
}

async function saveSettings() {
  const val = (id) => document.getElementById(id).value;
  await store.updateSettings({
    ...(document.getElementById('set-name') ? { displayName: val('set-name').trim() } : {}),
    startingBalance: parseFloat(val('set-balance')) || 0,
    baseCurrency: val('set-currency') || 'USDT',
    ...(document.getElementById('set-risk') ? { defaultRiskPct: parseFloat(val('set-risk')) || 1 } : {}),
    defaultLeverage: parseFloat(val('set-lev')) || 1,
    commissionRatePct: parseFloat(val('set-comm')) || 0,
    defaultSlippagePct: parseFloat(val('set-slip')) || 0,
    tp1ClosePct: parseFloat(val('set-tp1')) || 0,
    tp2ClosePct: parseFloat(val('set-tp2')) || 0,
    beBuffer: parseFloat(val('set-bebuf')) || 0,
    breakevenAfterTp1: document.getElementById('set-beflag').checked,
  });
  await load();
  render();
  toast('Параметры сохранены — статистика пересчитана');
}

async function addCashflow() {
  formModal('Движение средств', [
    { id: 'cf-type', label: 'Тип', type: 'select', options: [['deposit', 'Депозит'], ['withdrawal', 'Вывод']] },
    { id: 'cf-amount', label: 'Сумма, $', type: 'number', step: '0.01' },
    { id: 'cf-date', label: 'Дата', type: 'datetime-local', value: F.toDatetimeLocal() },
    { id: 'cf-note', label: 'Комментарий', type: 'text' },
  ], async (v) => {
    await store.createCashflow({
      type: v['cf-type'],
      amount: Math.abs(parseFloat(v['cf-amount']) || 0),
      date: F.fromDatetimeLocal(v['cf-date']),
      note: v['cf-note'] || undefined,
    });
    await load();
    render();
    toast('Движение добавлено');
  });
}
async function removeCashflow(id) {
  await store.deleteCashflow(id);
  await load();
  render();
}
async function addAccount() {
  formModal('Новый счёт', [
    { id: 'acc-name', label: 'Название (например, «Bybit Реал»)', type: 'text' },
    { id: 'acc-exchange', label: 'Биржа (необязательно)', type: 'text' },
    { id: 'acc-demo', label: 'Демо-счёт', type: 'select', options: [['no', 'Нет'], ['yes', 'Да']] },
    { id: 'acc-balance', label: 'Стартовый баланс, $', type: 'number', step: '0.01', value: '10000' },
  ], async (v) => {
    if (!v['acc-name']) return;
    await store.createAccount({
      name: v['acc-name'],
      exchange: v['acc-exchange'] || undefined,
      isDemo: v['acc-demo'] === 'yes',
      startingBalance: parseFloat(v['acc-balance']) || 0,
      currency: state.settings.baseCurrency,
    });
    await load();
    render();
    toast('Счёт добавлен');
  });
}
async function removeAccount(account) {
  const tradeCount = state.trades.filter((t) => t.accountId === account.id).length;
  const cfCount = state.cashflows.filter((c) => c.accountId === account.id).length;
  const details = tradeCount || cfCount
    ? ` Вместе со счётом удалятся: сделок — ${tradeCount}, движений средств — ${cfCount}.`
    : '';
  confirmModal(`Удалить счёт «${account.name}»? Действие необратимо.${details}`, async () => {
    await store.deleteAccount(account.id);
    await load();
    render();
    toast('Счёт удалён');
  });
}
async function addStrategy() {
  formModal('Новая стратегия', [
    { id: 's-name', label: 'Название', type: 'text' },
    { id: 's-module', label: 'Модуль курса (необязательно)', type: 'text' },
  ], async (v) => {
    if (!v['s-name']) return;
    await store.createStrategy({ name: v['s-name'], moduleRef: v['s-module'] || undefined });
    await load();
    render();
    toast('Стратегия добавлена');
  });
}

// ─────────────────────────────────────────────────────────────── TRADE CARD ──
function openTradeCard(id) {
  const t = state.trades.find((x) => x.id === id);
  if (!t) return;
  showTradeCard(t, { balanceFor: equityForAccount, extra: studentCommentsBlock(store, t.id, state.mentor) });
}

/**
 * Карточка сделки в модалке — общая для дневника ученика и кабинета наставника.
 * balanceFor(accountId) — баланс счёта для расчёта доходности; readOnly — без кнопок
 * «Удалить / Редактировать / Закрыть сделку»; extra — узел под заметками (комментарии наставника).
 * Данные сделки могут быть чужими (открывает наставник) — всё, что попадает в html, экранируется.
 */
function showTradeCard(t, { balanceFor, readOnly = false, extra = null }) {
  const r = computeTradeResult(t, { prices: t.currentPrice ? { [t.symbol]: t.currentPrice } : {}, accountBalanceAtEntry: balanceFor(t.accountId) });

  const kv = (k, v, cls = '') => h('div.kv', {}, [h('span.kv-k', { text: k }), h('span.kv-v', { class: cls, html: v })]);

  openModal(
    h('div', {}, [
      h('div.modal-head', {}, [
        h('div', {}, [
          h('h2', { style: 'font-size:18px;', html: `${esc(t.symbol)} · <span class="dir ${esc(t.direction)}">${esc(F.DIRECTION_LABEL[t.direction])}</span>` }),
          h('div', {
            style: 'font-size:12.5px;color:var(--ink-2);margin-top:4px;',
            html: `${F.dateTime(t.openedAt)} · ${esc(F.SESSION_LABEL[t.session] || '—')} · ${t.strategyName ? `<span class="tag">${esc(t.strategyName)}</span>` : '—'} · ${r.isOpen ? '<span style="color:var(--accent)">открыта</span>' : 'закрыта'} · источник: ${esc(srcLabel(t.source))}`,
          }),
        ]),
        h('button.modal-close', { onclick: closeModal, 'aria-label': 'Закрыть', text: '✕' }),
      ]),
      h('div.modal-body', {}, [
        h('div', {}, [
          h('div.section-label', { style: 'margin-bottom:10px;', text: 'План' }),
          h('div.kv-grid', {}, [
            kv('Вход', F.num(t.entry)),
            kv('Первонач. стоп', F.num(t.initialStop ?? t.stop), 'neg-text'),
            kv('Рабочий стоп', F.num(r.workingStop), r.movedToBreakeven ? 'pos-text' : ''),
            kv('TP1 / TP2 / TP3', [t.tp1, t.tp2, t.tp3 ?? t.target].map((x) => (x != null ? F.num(x) : '—')).join(' / '), 'pos-text'),
            kv('Размер · плечо', `${F.num(t.size)}${t.leverage ? ` · ${t.leverage}×` : ''}`),
            kv('Первоначальный риск (1R)', F.usd(r.risk)),
            kv('Плановый R', r.plannedR != null ? F.rMult(r.plannedR) : '—'),
            kv('Защищённый R (TP1+БУ)', r.protectedR != null ? F.rMult(r.protectedR) : '—'),
            kv('RR до финальной цели', r.rrPlanned ? `1 : ${r.rrPlanned.toFixed(1)}` : '—'),
          ]),
        ]),
        h('div', {}, [
          h('div.section-label', { style: 'margin-bottom:10px;', text: `Результат${r.isOpen ? ' (часть нереализована)' : ''}` }),
          h('div.kv-grid', {}, [
            kv('Закрыто / осталось', `${F.num(r.closedSize)} / ${F.num(r.openSize)}`),
            kv('Средняя цена выхода', r.avgExit != null ? F.num(r.avgExit) : '—'),
            kv('Реализованный P&L', F.usd(r.realizedPnl, { sign: true }), r.realizedPnl >= 0 ? 'pos-text' : 'neg-text'),
            kv(r.isOpen ? 'Нереализованный P&L' : 'Итоговый P&L', r.isOpen ? (t.currentPrice ? F.usd(r.unrealizedPnl, { sign: true }) : '—') : F.usd(r.pnl, { sign: true }), (r.isOpen ? r.unrealizedPnl : r.pnl) >= 0 ? 'pos-text' : 'neg-text'),
            kv('R-мультипликатор', !r.isOpen || t.currentPrice ? F.rMult(r.rMultiple) : `реализ. ${F.rMult(r.realizedR)}`, r.rMultiple >= 0 ? 'pos-text' : 'neg-text'),
            kv('Доходность счёта', r.returnOnAccountPct != null && !r.isOpen ? F.pct(r.returnOnAccountPct, 2) : '—'),
            kv('Время в позиции', F.duration(r.holdingHours)),
          ]),
        ]),
        r.exits.length
          ? h('div', {}, [
              h('div.section-label', { style: 'margin-bottom:8px;', text: 'Частичные закрытия' }),
              h('div.row-list', {}, r.exits.map((e) => {
                const legPnl = (e.price - t.entry) * e.size * (t.direction === 'short' ? -1 : 1);
                return h('div.row-item', {}, [
                  h('span', { html: `<span class="tag">${esc(exitKindLabel(e.kind))}</span> ${F.num(e.price)} × ${F.num(e.size)}${e.at ? ` · ${F.dateTime(e.at)}` : ''}` }),
                  h('span.mono', { class: legPnl >= 0 ? 'pos-text' : 'neg-text', text: F.usd(legPnl, { sign: true }) }),
                ]);
              })),
            ])
          : null,
        h('div', {}, [
          h('div.section-label', { style: 'margin-bottom:8px;', text: 'График сделки' }),
          h('div', { style: 'border-radius:8px;overflow:hidden;border:1px solid var(--border);', html: tradeMiniChart(t) }),
          chartLinks(t),
        ]),
        t.notes ? h('div', {}, [h('div.section-label', { style: 'margin-bottom:8px;', text: 'Заметки' }), h('div.callout', { text: t.notes })]) : null,
        extra,
      ]),
      readOnly ? null : h('div.modal-foot', {}, [
        h('button.btn.btn-danger', { onclick: () => deleteTrade(t.id) }, [h('span', { html: svgIcon(ICONS.trash, 14) }), 'Удалить']),
        h('div', { style: 'display:flex;gap:8px;' }, [
          r.isOpen ? h('button.btn', { onclick: () => openCloseForm(t) }, ['Закрыть сделку']) : null,
          h('button.btn.btn-primary', { onclick: () => openTradeForm(t.id) }, ['Редактировать']),
        ]),
      ]),
    ]),
  );
}
/** Ссылки на график TradingView из сделки (только http/https) — кнопками, чтобы наставник открывал их в один клик. */
function chartLinks(t) {
  const urls = (t.screenshotUrls || []).map(safeHttpUrl).filter(Boolean);
  if (!urls.length) return null;
  return h('div', { style: 'margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;' }, urls.map((href) =>
    h('a.btn', { href, target: '_blank', rel: 'noopener noreferrer', title: href }, [`Открыть график · ${new URL(href).hostname.replace(/^www\./, '')} ↗`]),
  ));
}
function srcLabel(s) {
  return { manual: 'ручной ввод', shorthand: 'быстрый ввод', screenshot: 'скриншот', import: 'импорт' }[s] || s;
}
function exitKindLabel(k) {
  return { tp1: 'TP1', tp2: 'TP2', tp3: 'TP3', be: 'безубыток', stop: 'стоп', manual: 'ручное' }[k] || k;
}

function deleteTrade(id) {
  confirmModal('Удалить сделку? Действие необратимо.', async () => {
    await store.deleteTrade(id);
    await load();
    render();
    toast('Сделка удалена');
  });
}

// ─────────────────────────────────────────────────────────────── TRADE FORM ──
function openTradeForm(id) {
  activeScreenshotCleanup = null; // защитный сброс — на новый вызов формы старого cleanup быть не должно
  const editing = id ? state.trades.find((x) => x.id === id) : null;
  const d = state.settings;
  const draft = editing
    ? {
        ...editing,
        accountId: editing.accountId ?? state.accounts[0]?.id,
        openedAt: F.toDatetimeLocal(editing.openedAt),
        initialStop: editing.initialStop ?? editing.plannedStop ?? editing.stop ?? '',
        tp1: editing.tp1 ?? '', tp2: editing.tp2 ?? '',
        tp3: editing.tp3 ?? editing.plannedTarget ?? editing.target ?? '',
        tp1Pct: editing.tp1Pct ?? d.tp1ClosePct,
        tp2Pct: editing.tp2Pct ?? d.tp2ClosePct,
        breakevenAfterTp1: editing.breakevenAfterTp1 ?? d.breakevenAfterTp1,
        beBuffer: editing.beBuffer ?? d.beBuffer,
        currentPrice: editing.currentPrice ?? '',
        feesPaid: editing.feesPaid ?? '',
        riskPct: d.defaultRiskPct,
        screenshot: editing.screenshotUrls?.[0] || '',
        exits: normalizeExitsForForm(editing),
      }
    : {
        accountId: state.accounts[0]?.id,
        symbol: '', direction: 'long', entry: '', initialStop: '', size: '',
        tp1: '', tp2: '', tp3: '',
        tp1Pct: d.tp1ClosePct, tp2Pct: d.tp2ClosePct,
        breakevenAfterTp1: d.breakevenAfterTp1, beBuffer: d.beBuffer,
        leverage: d.defaultLeverage, riskPct: d.defaultRiskPct,
        openedAt: F.toDatetimeLocal(), currentPrice: '',
        strategyId: '', session: '', timeframe: '1h', feesPaid: '', notes: '', screenshot: '',
        exits: [],
      };

  const $ = {};
  const RECALC_KEYS = ['entry', 'initialStop', 'tp1', 'tp2', 'tp3', 'tp1Pct', 'tp2Pct', 'size', 'leverage', 'riskPct', 'direction', 'beBuffer', 'breakevenAfterTp1', 'accountId'];
  const field = (key, label, opts = {}) => {
    let inp;
    if (opts.type === 'select') {
      inp = h('select', {}, opts.options.map(([v, t]) => h('option', { value: v, selected: String(draft[key] ?? '') === String(v) }, [t])));
    } else if (opts.type === 'textarea') {
      inp = h('textarea', { rows: 2 }, [draft[key] ?? '']);
    } else if (opts.type === 'checkbox') {
      inp = h('input', { type: 'checkbox', checked: !!draft[key] });
    } else if (opts.type === 'sizeUsd') {
      // Поле показывает/принимает доллары; хранится (draft[key]) всегда в монетах —
      // так его ждут calc/trade.js и store. Конвертация — по текущей цене входа.
      const usd = num(draft[key]) > 0 && num(draft.entry) > 0 ? num(draft[key]) * num(draft.entry) : '';
      inp = h('input', { class: opts.mono ? 'mono' : '', type: 'number', step: opts.step, value: usd === '' ? '' : usd.toFixed(2) });
    } else {
      inp = h('input', { class: opts.mono ? 'mono' : '', type: opts.type || 'text', step: opts.step, value: draft[key] ?? '', placeholder: opts.ph || '' });
    }
    const commit = () => {
      if (opts.type === 'checkbox') draft[key] = inp.checked;
      else if (opts.type === 'sizeUsd') {
        const usd = parseFloat(inp.value);
        const entry = num(draft.entry);
        draft[key] = entry > 0 ? usd / entry : NaN;
      }
      else if (opts.type === 'select' || opts.type === 'textarea' || !opts.type) draft[key] = inp.value;
      else draft[key] = parseFloat(inp.value);
      if (RECALC_KEYS.includes(key)) { refreshPlan(); renderExits(); }
    };
    inp.addEventListener('input', commit);
    inp.addEventListener('change', commit);
    $[key] = inp;
    if (opts.type === 'checkbox') {
      return h('div.field', {}, [
        h('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer;' }, [inp, label]),
        opts.hint ? h('div.hint', { text: opts.hint }) : null,
      ]);
    }
    return h('div.field', { class: opts.span2 ? 'span2' : '' }, [
      h('label', { text: label }),
      inp,
      opts.hint ? h('div.hint', { text: opts.hint }) : null,
    ]);
  };

  // ── редактор частичных закрытий ──
  const exitsBox = h('div');
  const remainingSize = () => Math.max(0, (num(draft.size) || 0) - draft.exits.reduce((s, e) => s + (num(e.size) || 0), 0));
  function addExit(kind) {
    const dir = draft.direction;
    const buf = num(draft.beBuffer) || 0;
    const be = (num(draft.entry) || 0) + (dir === 'long' ? buf : -buf);
    const rem = remainingSize();
    const preset = {
      tp1: { price: num(draft.tp1), size: (num(draft.size) || 0) * (num(draft.tp1Pct) || 0) / 100 },
      tp2: { price: num(draft.tp2), size: (num(draft.size) || 0) * (num(draft.tp2Pct) || 0) / 100 },
      tp3: { price: num(draft.tp3), size: rem },
      stop: { price: num(draft.initialStop), size: rem },
      be: { price: be, size: rem },
      manual: { price: num(draft.currentPrice) || num(draft.entry), size: rem },
    }[kind];
    draft.exits.push({
      kind,
      price: Number.isFinite(preset.price) ? preset.price : '',
      size: Math.min(preset.size || 0, rem || preset.size || 0) || '',
      at: F.toDatetimeLocal(),
    });
    renderExits();
    refreshPlan();
  }
  function renderExits() {
    const rem = remainingSize();
    const rows = draft.exits.map((e, i) =>
      h('div', { style: 'display:grid;grid-template-columns:96px 1fr 1fr 28px;gap:8px;align-items:center;margin-bottom:6px;' }, [
        h('select', {
          onchange: (ev) => { e.kind = ev.target.value; },
        }, [['tp1', 'TP1'], ['tp2', 'TP2'], ['tp3', 'TP3'], ['be', 'БУ'], ['stop', 'Стоп'], ['manual', 'Ручное']].map(([v, l]) =>
          h('option', { value: v, selected: e.kind === v }, [l]))),
        h('input.mono', { type: 'number', step: 'any', value: e.price, placeholder: 'цена', oninput: (ev) => { e.price = parseFloat(ev.target.value); refreshPlan(); } }),
        h('input.mono', { type: 'number', step: 'any', value: e.size, placeholder: 'объём', oninput: (ev) => { e.size = parseFloat(ev.target.value); refreshPlan(); renderExits(); } }),
        h('button.btn.btn-ghost', { onclick: () => { draft.exits.splice(i, 1); renderExits(); refreshPlan(); }, html: svgIcon(ICONS.trash, 12), 'aria-label': 'Убрать' }),
      ]),
    );
    mount(
      exitsBox,
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;' }, [
        h('button.btn', { style: 'font-size:12px;padding:5px 10px;', onclick: () => addExit('tp1') }, [`TP1 (${draft.tp1Pct || 0}%)`]),
        h('button.btn', { style: 'font-size:12px;padding:5px 10px;', onclick: () => addExit('tp2') }, [`TP2 (${draft.tp2Pct || 0}%)`]),
        h('button.btn', { style: 'font-size:12px;padding:5px 10px;', onclick: () => addExit('tp3') }, ['TP3 (остаток)']),
        h('button.btn', { style: 'font-size:12px;padding:5px 10px;', onclick: () => addExit('be') }, ['Безубыток']),
        h('button.btn', { style: 'font-size:12px;padding:5px 10px;', onclick: () => addExit('stop') }, ['Стоп']),
        h('button.btn.btn-ghost', { style: 'font-size:12px;padding:5px 10px;', onclick: () => addExit('manual') }, ['+ строка']),
      ]),
      ...(rows.length ? rows : [h('div.hint', { text: 'Пока нет закрытий — позиция открыта полностью.' })]),
      h('div.hint', { style: 'margin-top:6px;', text: `Полный размер: ${F.num(num(draft.size) || 0)} · закрыто: ${F.num((num(draft.size) || 0) - rem)} · осталось: ${F.num(rem)}` }),
    );
  }

  const planPanel = h('div.calc-panel');
  /** Держит поле «Размер позиции, $» в долларах при смене входа (монеты — источник правды в draft.size). */
  function syncSizeUsdField() {
    if (!$.size || document.activeElement === $.size) return; // не мешаем набирать текст
    const entry = num(draft.entry);
    const usd = entry > 0 && num(draft.size) > 0 ? entry * num(draft.size) : '';
    $.size.value = usd === '' ? '' : usd.toFixed(2);
  }
  function refreshPlan() {
    syncSizeUsdField();
    const entry = num(draft.entry);
    const stop = num(draft.initialStop);
    const riskPct = num(draft.riskPct);
    const leverage = num(draft.leverage) || 1;
    const dir = draft.direction;
    const deposit = draft.accountId ? equityForAccount(draft.accountId) : state.stats.equityNow;
    const finalTp = num(draft.tp3) || num(draft.tp2) || num(draft.tp1);

    if (!FEATURES.positionCalc) {
      // Версия без калькулятора: размер вводит пользователь, плановый R — от него.
      const size = num(draft.size);
      if (!(entry > 0) || !(stop > 0) || !(size > 0) || entry === stop) {
        mount(planPanel, h('div', { style: 'color:var(--muted);font-size:12.5px;', text: 'Заполните вход, стоп и размер позиции — покажу плановый R.' }));
        return;
      }
      const lots = { direction: dir, entry, initialStop: stop, size, tp1: num(draft.tp1), tp2: num(draft.tp2), tp3: num(draft.tp3), tp1Pct: num(draft.tp1Pct), tp2Pct: num(draft.tp2Pct), beBuffer: num(draft.beBuffer) };
      const plannedR = blendedPlannedR(lots);
      const protR = protectedR(lots);
      const risk1R = Math.abs(entry - stop) * size;
      const rows = [
        ['Первоначальный риск (1R)', F.usd(risk1R)],
        ['Риск от депозита', deposit > 0 ? `${((risk1R / deposit) * 100).toFixed(2)} %` : '—'],
        ['Плановый R (все цели по %)', plannedR != null ? F.rMult(plannedR) : '—'],
        ['Защищённый R (TP1 + БУ)', protR != null ? F.rMult(protR) : '—'],
      ];
      mount(
        planPanel,
        h('div.section-label', { style: 'margin-bottom:8px;', text: 'Плановый результат' }),
        ...rows.map(([k, v]) => h('div.calc-row', {}, [h('span', { text: k }), h('b', { text: v })])),
      );
      return;
    }

    if (!(entry > 0) || !(stop > 0) || !(riskPct > 0)) {
      mount(planPanel, h('div', { style: 'color:var(--muted);font-size:12.5px;', text: 'Заполните вход, стоп и риск % — покажу расчёт позиции.' }));
      return;
    }
    let plan;
    try {
      plan = computePlan({
        deposit, riskPct, entry, stop,
        target: finalTp > 0 ? finalTp : entry * (dir === 'long' ? 1.01 : 0.99),
        direction: dir, leverage,
        commissionRatePct: state.settings.commissionRatePct,
        slippagePct: state.settings.defaultSlippagePct,
      });
    } catch {
      mount(planPanel, h('div', { style: 'color:var(--loss-ink);font-size:12.5px;', text: 'Проверьте значения цен.' }));
      return;
    }
    const size = num(draft.size);
    const plannedR = blendedPlannedR({ direction: dir, entry, initialStop: stop, size: size || plan.positionQty, tp1: num(draft.tp1), tp2: num(draft.tp2), tp3: num(draft.tp3), tp1Pct: num(draft.tp1Pct), tp2Pct: num(draft.tp2Pct), beBuffer: num(draft.beBuffer) });
    const protR = protectedR({ direction: dir, entry, initialStop: stop, size: size || plan.positionQty, tp1: num(draft.tp1), tp1Pct: num(draft.tp1Pct), beBuffer: num(draft.beBuffer) });

    const rows = [
      ['Депозит (из журнала)', F.usd(deposit)],
      ['Первоначальный риск (1R)', F.usd(plan.riskAmount)],
      ['Размер позиции', `${F.usd(plan.totalVolume)} (${F.num(plan.positionQty)} монет)`],
      ['Маржа', F.usd(plan.marginRequired)],
      ['Risk / Reward до финальной цели', finalTp > 0 ? `1 : ${plan.riskReward.toFixed(2)}` : '—'],
      ['Плановый R (все цели по %)', plannedR != null ? F.rMult(plannedR) : '—'],
      ['Защищённый R (TP1 + БУ)', protR != null ? F.rMult(protR) : '—'],
      ['Потенц. убыток (с комис.)', '−' + F.usd(plan.netLossAtStop).slice(1)],
      ['Цена ликвидации ≈', F.num(plan.liquidationPrice)],
    ];
    mount(
      planPanel,
      h('div.section-label', { style: 'margin-bottom:8px;', text: 'Расчёт позиции (ядро калькулятора)' }),
      ...rows.map(([k, v]) => h('div.calc-row', {}, [h('span', { text: k }), h('b', { text: v })])),
      h('button.btn', { style: 'margin-top:10px;width:100%;justify-content:center;', onclick: () => { draft.size = plan.positionQty; $.size.value = plan.totalVolume.toFixed(2); refreshPlan(); renderExits(); } }, ['Подставить размер в форму']),
      plan.liquidationBeforeStop
        ? h('div.calc-warn', { html: `${svgIcon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', 13)} Ликвидация ближе стопа — плечо слишком большое` })
        : null,
    );
  }

  // ── OCR по скриншоту TradingView (только для новой сделки) ──
  // Скриншот живёт ТОЛЬКО в памяти вкладки: File → ObjectURL → <img> →
  // canvas (browser-image.js) → пиксели для recognizeScreenshot(). Ничего не
  // грузится в Supabase Storage и не пишется в localStorage/Database — см.
  // cleanupScreenshot() ниже и её вызов из closeModal(). В draft/payload
  // попадают только value-поля результата (Pair/Direction/Entry/Stop/
  // Target/Timeframe) — cropDataUrl (base64-превью кропов для отладки) в
  // draft никогда не копируется, поэтому не может попасть в createTrade.
  const ocrFileInput = h('input', { type: 'file', accept: 'image/*' });
  const ocrStatus = h('div.hint');
  const ocrPreview = h('div');
  const ocrSummary = h('div');
  let screenshotSession = null; // { objectUrl } — только пока форма открыта

  function cleanupScreenshot() {
    if (!screenshotSession) return;
    URL.revokeObjectURL(screenshotSession.objectUrl);
    screenshotSession = null;
    ocrFileInput.value = '';
    ocrStatus.textContent = '';
    mount(ocrPreview);
    mount(ocrSummary);
  }

  function applyOcrResult(result) {
    const setField = (key, field) => {
      if (!field || field.value == null) return;
      draft[key] = field.value;
      if ($[key]) $[key].value = field.value;
    };
    setField('symbol', result.pair);
    setField('direction', result.direction);
    setField('entry', result.entry);
    setField('initialStop', result.stop);
    setField('tp3', result.target);
    setField('timeframe', result.timeframe);
    draft.source = 'screenshot';
    refreshPlan();
    renderExits();

    const badge = { high: '🟢', medium: '🟡', low: '🔴' };
    const rows = [
      ['Пара', result.pair], ['Направление', result.direction], ['Вход', result.entry],
      ['Стоп', result.stop], ['Тейк (TP3)', result.target], ['Таймфрейм', result.timeframe],
    ];
    mount(
      ocrSummary,
      h('div', { style: 'display:flex;flex-direction:column;gap:3px;font-size:12.5px;margin-top:8px;' }, [
        ...rows.map(([label, f]) => h('div', {}, [
          `${f ? badge[f.confidence] || '⬜' : '⬜'} ${label}: `,
          h('b', { text: f ? String(f.value) : '— не найдено —' }),
          f?.notes?.length ? h('div', { style: 'color:var(--muted);font-size:11px;', text: f.notes.join('; ') }) : null,
        ])),
        h('div.hint', { style: 'margin-top:4px;', text: 'Даже 🟢 не гарантирует правильность — проверьте все поля ниже перед сохранением.' }),
      ]),
    );
  }

  ocrFileInput.addEventListener('change', async () => {
    const file = ocrFileInput.files?.[0];
    if (!file) return;
    cleanupScreenshot(); // на случай повторного выбора файла — сначала освобождаем предыдущий

    const objectUrl = URL.createObjectURL(file);
    const imgEl = h('img', { src: objectUrl, style: 'max-width:200px;max-height:200px;border-radius:8px;border:1px solid var(--border);display:block;' });
    screenshotSession = { objectUrl };
    activeScreenshotCleanup = cleanupScreenshot;
    mount(ocrPreview, imgEl);
    mount(ocrSummary);
    ocrStatus.textContent = 'Распознаю…';

    try {
      await imgEl.decode();
      const image = loadBrowserImage(imgEl);
      const result = await recognizeScreenshot(image);
      applyOcrResult(result);
      ocrStatus.textContent = 'Готово — проверьте и при необходимости исправьте поля ниже.';
    } catch (err) {
      ocrStatus.textContent = 'Не удалось распознать скриншот — заполните поля вручную.';
    }
  });

  const ocrBlock = editing ? null : h('div', {}, [
    h('div.section-label', { style: 'margin-bottom:6px;', text: 'Распознать скриншот TradingView (необязательно)' }),
    h('div', { style: 'display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;' }, [
      h('div', {}, [ocrFileInput, ocrStatus]),
      ocrPreview,
    ]),
    ocrSummary,
    h('div.hint', { style: 'margin-top:4px;', text: 'Обрабатывается локально в браузере (Tesseract.js) — скриншот никуда не отправляется. После сохранения или отмены удаляется из памяти, нигде не хранится.' }),
  ]);

  const shInput = h('input', { placeholder: 'BTCUSDT short 79230 sl 79485 tp 78465 risk 1% x10', 'aria-label': 'Быстрый ввод' });
  const shMsg = h('div.parse-msg');
  const shBtn = h('button.btn', { onclick: () => applyShorthand() }, ['Разобрать']);
  shInput.addEventListener('keydown', (e) => e.key === 'Enter' && applyShorthand());
  function applyShorthand() {
    const res = parseShorthand(shInput.value);
    if (!res.ok) {
      shMsg.className = 'parse-msg err';
      shMsg.textContent = res.error + (res.warnings.length ? ` (${res.warnings.join('; ')})` : '');
      return;
    }
    const map = { stop: 'initialStop', target: 'tp3' };
    for (const [k, v] of Object.entries(res.data)) {
      const key = map[k] || k;
      draft[key] = v;
      if ($[key]) $[key].value = v;
    }
    draft.source = 'shorthand';
    shMsg.className = 'parse-msg ok';
    shMsg.textContent = '✓ Поля заполнены. ' + (res.warnings.length ? 'Проверьте: ' + res.warnings.join('; ') : 'Проверьте и сохраните.');
    refreshPlan();
    renderExits();
  }

  const stratOptions = [['', '—'], ...state.strategies.map((s) => [s.id, s.name])];

  const body = h('div.modal-body', {}, [
    ocrBlock,
    editing ? null : h('div', {}, [
      h('div.section-label', { style: 'margin-bottom:6px;', text: 'Быстрый ввод (необязательно)' }),
      h('div.shorthand-box', {}, [shInput, shBtn]),
      shMsg,
    ]),
    h('div.form-grid.three', {}, [
      state.accounts.length > 1
        ? field('accountId', 'Счёт', { type: 'select', options: state.accounts.map((a) => [a.id, a.name]) })
        : null,
      field('symbol', 'Пара', { mono: true, ph: 'BTCUSDT' }),
      field('direction', 'Направление', { type: 'select', options: [['long', 'LONG'], ['short', 'SHORT']] }),
      field('timeframe', 'Таймфрейм', { ph: '1h' }),
      field('entry', 'Вход', { type: 'number', step: 'any', mono: true }),
      field('initialStop', 'Стоп (первоначальный)', { type: 'number', step: 'any', mono: true, hint: '1R фиксируется здесь' }),
      field('size', 'Размер позиции, $', { type: 'sizeUsd', step: 'any', mono: true, hint: 'долларовый объём позиции по цене входа; хранится в монетах — при смене входа число здесь пересчитается' }),
      field('leverage', 'Плечо', { type: 'number', step: '1', mono: true }),
      FEATURES.positionCalc ? field('riskPct', 'Риск, %', { type: 'number', step: '0.1', mono: true, hint: 'для расчёта размера' }) : null,
      field('openedAt', 'Открыта', { type: 'datetime-local' }),
    ]),
    h('div', {}, [
      h('div.section-label', { style: 'margin:6px 0 8px;', text: 'Цели и перевод в безубыток' }),
      h('div.form-grid.three', {}, [
        field('tp1', 'TP1', { type: 'number', step: 'any', mono: true }),
        field('tp2', 'TP2', { type: 'number', step: 'any', mono: true }),
        field('tp3', 'TP3 (финальная)', { type: 'number', step: 'any', mono: true }),
        field('tp1Pct', 'Фиксация на TP1, %', { type: 'number', step: '1', mono: true }),
        field('tp2Pct', 'Фиксация на TP2, %', { type: 'number', step: '1', mono: true }),
        field('beBuffer', 'Буфер безубытка (цена)', { type: 'number', step: 'any', mono: true, hint: '0 = ровно вход' }),
      ]),
      field('breakevenAfterTp1', 'После TP1 переносить стоп в безубыток', { type: 'checkbox' }),
    ]),
    h('div', {}, [
      h('div.section-label', { style: 'margin:6px 0 8px;', text: 'Частичные закрытия (факт)' }),
      exitsBox,
    ]),
    h('div.form-grid.three', {}, [
      field('currentPrice', 'Текущая цена (для открытого остатка)', { type: 'number', step: 'any', mono: true }),
      field('feesPaid', 'Комиссии по факту, $', { type: 'number', step: '0.01', mono: true }),
      field('strategyId', 'Стратегия', { type: 'select', options: stratOptions }),
      field('session', 'Сессия', { type: 'select', options: [['', '—'], ['asia', 'Азия'], ['london', 'Лондон'], ['newyork', 'Нью-Йорк']] }),
      field('screenshot', 'Ссылка на график TradingView (наставник увидит её в сделке)', { span2: true, ph: 'https://www.tradingview.com/x/...' }),
      field('notes', 'Заметки', { type: 'textarea', span2: true }),
    ]),
    planPanel,
  ]);

  openModal(
    h('div.wide', {}, [
      h('div.modal-head', {}, [
        h('div', {}, [
          h('h2', { style: 'font-size:18px;', text: editing ? 'Редактирование сделки' : 'Новая сделка' }),
          h('div', { style: 'font-size:12px;color:var(--muted);margin-top:3px;', text: 'Проверьте поля и сохраните — журнал пересчитает статистику.' }),
        ]),
        h('button.modal-close', { onclick: closeModal, text: '✕' }),
      ]),
      body,
      h('div.modal-foot', {}, [
        h('span.card-note', { text: editing ? `id ${editing.id.slice(0, 8)}` : 'черновик — не сохранён' }),
        h('div', { style: 'display:flex;gap:8px;' }, [
          h('button.btn.btn-ghost', { onclick: closeModal }, ['Отмена']),
          h('button.btn.btn-primary', { onclick: () => saveTrade(draft, editing) }, [
            h('span', { html: svgIcon(ICONS.check) }),
            editing ? 'Сохранить' : 'Проверил — записать',
          ]),
        ]),
      ]),
    ]),
  );
  $modal.classList.add('wide');
  renderExits();
  refreshPlan();
}

/** Готовит exits редактируемыми в форме (datetime-local для at). */
function normalizeExitsForForm(trade) {
  const list = Array.isArray(trade.exits) && trade.exits.length
    ? trade.exits
    : trade.exit != null
      ? [{ kind: 'manual', price: trade.exit, size: trade.size, at: trade.closedAt }]
      : [];
  return list.map((e) => ({ kind: e.kind || 'manual', price: e.price, size: e.size, at: e.at ? F.toDatetimeLocal(e.at) : '' }));
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

async function saveTrade(draft, editing) {
  const errs = [];
  if (!draft.symbol) errs.push('пара');
  if (!(num(draft.entry) > 0)) errs.push('вход');
  if (!(num(draft.initialStop) > 0)) errs.push('стоп');
  if (!(num(draft.size) > 0)) errs.push('размер');
  if (!draft.openedAt) errs.push('дата открытия');
  if (errs.length) {
    toast('Заполните: ' + errs.join(', '));
    return;
  }
  const chartUrl = safeHttpUrl(draft.screenshot);
  if (String(draft.screenshot || '').trim() && !chartUrl) {
    toast('Ссылка на график не похожа на адрес сайта. Пример: https://www.tradingview.com/x/...');
    return;
  }

  const entry = num(draft.entry);
  const stop = num(draft.initialStop);
  const tp1 = num(draft.tp1) > 0 ? num(draft.tp1) : undefined;
  const tp2 = num(draft.tp2) > 0 ? num(draft.tp2) : undefined;
  const tp3 = num(draft.tp3) > 0 ? num(draft.tp3) : undefined;

  const exits = (draft.exits || [])
    .filter((e) => num(e.price) > 0 && num(e.size) > 0)
    .map((e) => ({
      kind: e.kind || 'manual',
      price: num(e.price),
      size: num(e.size),
      at: e.at ? F.fromDatetimeLocal(e.at) : new Date().toISOString(),
    }));

  const strat = state.strategies.find((s) => s.id === draft.strategyId);
  const payload = {
    ...(draft.accountId ? { accountId: draft.accountId } : {}),
    symbol: String(draft.symbol).toUpperCase().trim(),
    direction: draft.direction,
    timeframe: draft.timeframe || undefined,
    entry,
    initialStop: stop,
    stop, // legacy зеркало
    size: num(draft.size),
    leverage: num(draft.leverage) > 0 ? num(draft.leverage) : 1,
    tp1, tp2, tp3,
    tp1Pct: num(draft.tp1Pct) || undefined,
    tp2Pct: num(draft.tp2Pct) || undefined,
    breakevenAfterTp1: !!draft.breakevenAfterTp1,
    beBuffer: num(draft.beBuffer) || 0,
    exits,
    plannedEntry: entry,
    plannedStop: stop,
    plannedTarget: tp3 ?? tp2 ?? tp1,
    openedAt: F.fromDatetimeLocal(draft.openedAt) || new Date().toISOString(),
    currentPrice: num(draft.currentPrice) > 0 ? num(draft.currentPrice) : undefined,
    feesPaid: num(draft.feesPaid) > 0 ? num(draft.feesPaid) : 0,
    strategyId: draft.strategyId || null,
    strategyName: strat?.name,
    session: draft.session || undefined,
    notes: draft.notes || undefined,
    // первая ссылка — поле формы (пустое поле = ссылку убрали); остальные, если есть, не трогаем
    screenshotUrls: [...(chartUrl ? [chartUrl] : []), ...(editing?.screenshotUrls || []).slice(1)],
    source: draft.source || editing?.source || 'manual',
  };

  try {
    if (editing) await store.updateTrade(editing.id, payload);
    else await store.createTrade(payload);
  } catch (err) {
    // Модалку НЕ закрываем и скриншот не трогаем (closeModal чистит его) —
    // пользователь должен иметь возможность повторить сохранение.
    toast('Не удалось сохранить сделку — попробуйте ещё раз' + (err?.message ? `: ${err.message}` : ''));
    return;
  }
  await load();
  closeModal();
  render();
  toast(editing ? 'Сделка обновлена — статистика пересчитана' : 'Сделка записана — статистика пересчитана');
}

function openCloseForm(t) {
  const r = computeTradeResult(t, { prices: t.currentPrice ? { [t.symbol]: t.currentPrice } : {} });
  const rem = r.openSize;
  closeModal();
  formModal(`Закрыть остаток ${t.symbol} (${F.num(rem)})`, [
    { id: 'c-kind', label: 'Тип', type: 'select', options: [['tp3', 'TP3 / финальная цель'], ['be', 'Безубыток'], ['stop', 'Стоп'], ['manual', 'Ручное']] },
    { id: 'c-exit', label: 'Цена', type: 'number', step: 'any', value: t.tp3 ?? '' },
    { id: 'c-size', label: 'Объём (по умолчанию весь остаток)', type: 'number', step: 'any', value: rem },
    { id: 'c-date', label: 'Время', type: 'datetime-local', value: F.toDatetimeLocal() },
    { id: 'c-fees', label: 'Итоговые комиссии по сделке, $', type: 'number', step: '0.01', value: t.feesPaid ?? '' },
  ], async (v) => {
    const price = parseFloat(v['c-exit']);
    const size = parseFloat(v['c-size']) || rem;
    if (!(price > 0)) return toast('Укажите цену');
    const exits = [...(t.exits || []), { kind: v['c-kind'], price, size, at: F.fromDatetimeLocal(v['c-date']) }];
    await store.updateTrade(t.id, {
      exits,
      feesPaid: parseFloat(v['c-fees']) || t.feesPaid || 0,
      currentPrice: undefined,
    });
    await load();
    render();
    toast('Закрытие записано — статистика пересчитана');
  });
}

// ─────────────────────────────────────────────────────────────── generic modal ──
function openModal(node) {
  mount($modal, node);
  $overlay.hidden = false;
}
function closeModal() {
  // На ошибке сохранения saveTrade() не вызывает closeModal() — скриншот
  // намеренно НЕ трогаем, чтобы можно было повторить попытку.
  activeScreenshotCleanup?.();
  activeScreenshotCleanup = null;
  $overlay.hidden = true;
  $modal.classList.remove('wide');
  mount($modal);
}

/** Модальное окно подтверждения. onConfirm вызывается после закрытия окна. */
function confirmModal(message, onConfirm, { danger = true, confirmLabel = 'Удалить' } = {}) {
  openModal(
    h('div', {}, [
      h('div.modal-head', {}, [
        h('h2', { style: 'font-size:16px;', text: 'Подтверждение' }),
        h('button.modal-close', { onclick: closeModal, text: '✕' }),
      ]),
      h('div.modal-body', {}, [h('div', { style: 'font-size:13.5px;color:var(--ink-2);', text: message })]),
      h('div.modal-foot', {}, [
        h('span'),
        h('div', { style: 'display:flex;gap:8px;' }, [
          h('button.btn.btn-ghost', { onclick: closeModal }, ['Отмена']),
          h(`button.btn${danger ? '.btn-danger' : '.btn-primary'}`, {
            onclick: async () => { closeModal(); await onConfirm(); },
          }, [confirmLabel]),
        ]),
      ]),
    ]),
  );
}

function formModal(title, fields, onSubmit) {
  const inputs = {};
  const body = h('div.modal-body', {}, [
    h('div.form-grid', {}, fields.map((f) => {
      let inp;
      if (f.type === 'select') inp = h('select', {}, f.options.map(([v, t]) => h('option', { value: v }, [t])));
      else inp = h('input', { type: f.type || 'text', step: f.step, value: f.value ?? '' });
      inputs[f.id] = inp;
      return h('div.field', { class: fields.length % 2 && fields.indexOf(f) === fields.length - 1 ? 'span2' : '' }, [h('label', { text: f.label }), inp]);
    })),
  ]);
  openModal(
    h('div', {}, [
      h('div.modal-head', {}, [h('h2', { style: 'font-size:17px;', text: title }), h('button.modal-close', { onclick: closeModal, text: '✕' })]),
      body,
      h('div.modal-foot', {}, [
        h('span', {}),
        h('div', { style: 'display:flex;gap:8px;' }, [
          h('button.btn.btn-ghost', { onclick: closeModal }, ['Отмена']),
          h('button.btn.btn-primary', {
            onclick: async () => {
              const v = {};
              for (const [k, el] of Object.entries(inputs)) v[k] = el.value;
              closeModal();
              await onSubmit(v);
            },
          }, ['Сохранить']),
        ]),
      ]),
    ]),
  );
}

// ─────────────────────────────────────────────────────────────── theme / io ──
function applyStoredTheme() {
  try {
    const t = localStorage.getItem('rjournal:theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch {}
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('rjournal:theme', next);
  } catch {}
  render();
}
async function exportData() {
  const dump = await store.exportDump();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `r-journal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importData() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json';
  inp.onchange = async () => {
    const file = inp.files[0];
    if (!file) return;
    try {
      const dump = JSON.parse(await file.text());
      await store.importDump(dump);
      await load();
      render();
      toast('Данные импортированы');
    } catch {
      toast('Не удалось прочитать файл');
    }
  };
  inp.click();
}

let toastTimer;
function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 2600);
}
