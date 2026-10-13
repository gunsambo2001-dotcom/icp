// Форматирование для отображения. Только представление — никакой бизнес-логики.

const RU = 'ru-RU';

export function usd(v, { sign = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v < 0 ? '−' : sign ? '+' : '';
  const n = Math.abs(v);
  const body = n >= 1000
    ? n.toLocaleString(RU, { maximumFractionDigits: 0 })
    : n.toLocaleString(RU, { maximumFractionDigits: 2 });
  return `${s}$${body}`;
}

export function num(v) {
  if (typeof v !== 'number') v = v == null ? NaN : Number(v); // строка из чужих данных не должна попасть в html как есть
  if (Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  const digits = a >= 100000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 5;
  return v.toLocaleString(RU, { maximumFractionDigits: digits });
}

export function pct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v).toFixed(digits)}%`;
}

export function ratio01(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function rMult(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`;
}

export function factor(v) {
  if (v === Infinity) return '∞';
  if (v == null || Number.isNaN(v)) return '—';
  return v.toFixed(2);
}

const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_FULL = MON_FULL;
export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function dateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]}`;
}

export function dateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${hh}:${mm}`;
}

export function duration(hours) {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} мин`;
  if (hours < 48) return `${hours.toFixed(1)} ч`;
  return `${Math.round(hours / 24)} дн`;
}

/** Значение <input type="datetime-local"> из ISO (в локальном времени). */
export function toDatetimeLocal(iso) {
  const d = iso ? new Date(iso) : new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
}
/** ISO из значения <input type="datetime-local">. */
export function fromDatetimeLocal(v) {
  return v ? new Date(v).toISOString() : null;
}

export const SESSION_LABEL = { asia: 'Азия', london: 'Лондон', newyork: 'Нью-Йорк', '—': '—' };
export const DIRECTION_LABEL = { long: 'LONG', short: 'SHORT' };
