// Единый вход с сайта Гунсамбо. Кабинет открывает дневник со ссылкой вида
// …/dnevnik/#bridge_token=<token_hash>; токен выдаёт Edge Function diary-bridge (см. ТЗ_мост_дневника_diary-bridge.md).
// Здесь — разбор hash и обмен токена на сессию. Отрисовка экранов — в конце файла.
import { h, mount } from './dom.js';

/** Достаёт bridge_token из hash. null — токена в адресе нет; '' — параметр есть, но пустой. */
export function parseBridgeToken(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return params.has('bridge_token') ? params.get('bridge_token') : null;
}

/**
 * Обмен токена на сессию. Порядок важен: сначала локальный signOut (чтобы не остаться под чужой
 * сессией, например наставника с прошлого входа), потом verifyOtp. Только token_hash и type —
 * email для verifyOtp с token_hash передавать нельзя.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function bridgeSignIn(client, tokenHash, { timeoutMs = 45000 } = {}) {
  if (!tokenHash) return { ok: false, error: 'empty_token' };
  // Без таймаута зависший сетевой вызов оставлял «Входим…» навсегда.
  const withTimeout = (p, step) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout:' + step)), timeoutMs)),
  ]);
  // Сначала verifyOtp: он сам заменяет прежнюю сессию. signOut перед входом рассылал SIGNED_OUT
  // в другие вкладки/рамки этого же дневника и мог сбросить уже открытую сессию.
  let failure = '';
  try {
    const { error } = await withTimeout(client.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' }), 'verifyOtp');
    if (!error) return { ok: true };
    failure = error.message;
  } catch (e) {
    failure = String(e && e.message ? e.message : e);
  }
  // Вход не удался — чтобы не остаться под чужой сессией (например, наставника с прошлого раза), сбрасываем её.
  try {
    await withTimeout(client.auth.signOut({ scope: 'local' }), 'signOut');
  } catch {
    // нет сессии или сеть — не мешает показать ошибку
  }
  return { ok: false, error: failure };
}

function card(children) {
  const $app = document.getElementById('app');
  $app.removeAttribute('data-loading');
  $app.className = 'auth-screen';
  mount($app, h('div.auth-card.card', {}, [
    h('h1', { text: 'R-Дневник', style: 'font-size:18px;margin:0 0 4px;' }),
    ...children,
  ]));
}

/** Экран «входим…» — пока идёт обмен токена, формы логина нет. */
export function renderBridgeLoading() {
  card([h('p', { id: 'bridge-loading', text: 'Входим в дневник…', style: 'color:var(--ink-2);margin:0;font-size:13px;' }), h('p', { text: 'Первый вход может занять до минуты, не закрывайте страницу.', style: 'color:var(--ink-2);margin:8px 0 0;font-size:12px;' })]);
}

/** Токен просрочен/использован или в сборке нет входа по email и сессии нет. */
export function renderBridgeFailed({ onRetry, message = 'Не удалось войти. Вернитесь в кабинет и откройте вкладку «Дневник» заново.', detail = '' } = {}) {
  card([
    h('p', { id: 'bridge-failed', text: message, style: 'color:var(--ink-2);margin:0 0 14px;font-size:13px;' }),
    ...(detail ? [h('p', { id: 'bridge-detail', text: detail, style: 'color:var(--ink-3,#888);margin:0 0 14px;font-size:11px;' })] : []),
    h('button.btn.btn-primary', { id: 'bridge-retry', type: 'button', onclick: onRetry, style: 'width:100%;' }, ['Обновить']),
  ]);
}
