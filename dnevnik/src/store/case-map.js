// camelCase (JS/JSON-модель) ↔ snake_case (колонки Postgres/Supabase).
// Работает только на ВЕРХНЕМ уровне объекта — значения (в т.ч. jsonb-массивы
// exits, объект fieldConfidence с произвольными ключами-именами полей) не
// трогаем, иначе сломаем динамические ключи вроде fieldConfidence.entry.

export const camelToSnakeKey = (k) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
export const snakeToCamelKey = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** @param {object} obj */
export function camelToSnake(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[camelToSnakeKey(k)] = v;
  return out;
}

/** @param {object} obj */
export function snakeToCamel(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[snakeToCamelKey(k)] = v;
  return out;
}
