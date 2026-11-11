// Единая точка создания Supabase-клиента. Спецификатор '@supabase/supabase-js'
// резолвится по-разному в двух средах, без изменения кода:
//  - в браузере (index.html, без бандлера) — через <script type="importmap">
//    на vendor-сборку (см. index.html);
//  - в Node (npm test) — обычным способом из node_modules (пакет — dependency).
//
// Адресов проекта два (см. config.js): Cloudflare-прокси и прямой supabase.co.
// Прокси нужен там, где supabase.co закрыт, но сам он на *.workers.dev иногда
// просто рвёт соединение — тогда браузер показывает «Входим в дневник…» навсегда.
// Поэтому на старте оба проверяются health-запросом и дальше клиент ходит в тот,
// что ответил быстрее; если выбранный адрес отвалится в процессе — переключаемся.
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_URL_DIRECT, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const isBrowser = typeof window !== 'undefined';
const nativeFetch = isBrowser ? window.fetch.bind(window) : globalThis.fetch;
const BASE_KEY = 'rj_sb_base';
const PROBE_MS = 2500;
const BASES = [SUPABASE_URL, SUPABASE_URL_DIRECT];

// Клиент всегда создаётся с SUPABASE_URL, поэтому все его запросы начинаются
// с этого префикса — его и подменяем на выбранный адрес.
let base = SUPABASE_URL;
const rewrite = (url) =>
  typeof url === 'string' && url.startsWith(SUPABASE_URL) ? base + url.slice(SUPABASE_URL.length) : url;

const probe = async (u) => {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_MS);
  try {
    const r = await nativeFetch(u + '/auth/v1/health', {
      signal: ctl.signal,
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
    });
    return r.ok ? Date.now() - started : Infinity;
  } catch {
    return Infinity;
  } finally {
    clearTimeout(timer);
  }
};

// Выбор адреса: сначала запомненный в этой сессии, иначе — самый быстрый из ответивших.
export const baseReady = (async () => {
  if (!isBrowser) return base;
  let saved = null;
  try {
    saved = sessionStorage.getItem(BASE_KEY);
  } catch {
    // приватный режим — работаем без кэша
  }
  if (BASES.indexOf(saved) >= 0) {
    base = saved;
    return base;
  }
  const times = await Promise.all(BASES.map(probe));
  let fastest = Infinity;
  times.forEach((t, i) => {
    if (t < fastest) {
      fastest = t;
      base = BASES[i];
    }
  });
  try {
    sessionStorage.setItem(BASE_KEY, base);
  } catch {
    // не критично
  }
  return base;
})();

// Все запросы Supabase идут через этот fetch: он дожидается выбора адреса и
// повторяет запрос по запасному адресу, если текущий оборвал соединение.
const fetchThrough = async (input, init) => {
  await baseReady;
  try {
    return await nativeFetch(rewrite(input), init);
  } catch (err) {
    if (typeof input !== 'string' || !input.startsWith(SUPABASE_URL)) throw err;
    const alt = base === SUPABASE_URL ? SUPABASE_URL_DIRECT : SUPABASE_URL;
    const res = await nativeFetch(alt + input.slice(SUPABASE_URL.length), init);
    base = alt;
    try {
      sessionStorage.setItem(BASE_KEY, alt);
    } catch {
      // не критично
    }
    return res;
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: { fetch: (...args) => fetchThrough(...args) },
});
