// Реальная точка входа приложения (см. index.html). Решает, показывать ли
// экран входа или сразу приложение, и на каком store оно работает —
// ui/app.js про это ничего не знает (см. комментарий в его начале).
import { supabase } from '../supabase/client.js';
import { SupabaseStore } from '../store/supabase-store.js';
import { MentorStore } from '../store/mentor-store.js';
import { startApp } from './app.js';
import { renderAuthScreen, renderPasswordRecoveryScreen } from './auth.js';
import { FEATURES } from '../features.js';
import { parseBridgeToken, bridgeSignIn, renderBridgeLoading, renderBridgeFailed } from './bridge.js';

// Ссылка из письма «Забыли пароль?» приходит как #...&type=recovery. Supabase сам создаёт по ней
// сессию, поэтому без этой проверки человек молча оказался бы внутри без установки нового пароля.
let isRecovery = /[#&]type=recovery/.test(location.hash);
// Кабинет Гунсамбо открывает дневник для владельца/наставника с #staff — показываем вход по почте.
const staffEntry = location.hash === '#staff';
const linkFailed =/[#&](error_code=otp_expired|error=access_denied)/.test(location.hash);
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') isRecovery = true;
});

// Вход с сайта Гунсамбо: токен из hash сразу убираем из адреса, затем меняем на сессию.
const bridgeToken = parseBridgeToken(location.hash);
let bridgeFailed = false;
let bridgeError = '';
if (bridgeToken !== null) {
  history.replaceState(null, '', location.pathname + location.search);
  renderBridgeLoading();
  const bridgeRes = await bridgeSignIn(supabase, bridgeToken);
  bridgeFailed = !bridgeRes.ok;
  bridgeError = bridgeRes.error || '';
  if (bridgeFailed) console.error('[bridge] sign-in failed:', bridgeError);
  else {
    // Экран «Входим…» заменил каркас приложения, поэтому, как после обычного входа (auth.js), перезагружаем
    // страницу: токена в адресе уже нет, сессия есть — дневник стартует с чистого каркаса.
    location.reload();
    await new Promise(() => {});
  }
}

const { data: { session } } = await supabase.auth.getSession();
if (bridgeFailed) {
  renderBridgeFailed({ onRetry: () => location.reload(), detail: bridgeError });
} else if (isRecovery && session) {
  renderPasswordRecoveryScreen(supabase, {
    onDone: () => {
      history.replaceState(null, '', location.pathname);
      location.reload();
    },
  });
} else if (session) {
  await boot();
} else if (linkFailed) {
  history.replaceState(null, '', location.pathname);
  renderAuthScreen(supabase, {
    onAuthenticated: () => location.reload(),
    initialMode: 'forgot',
    initialError: 'Ссылка устарела или уже использована. Запросите новую.',
  });
} else if (!FEATURES.emailLogin && !staffEntry) {
  // Сборка для Гунсамбо: входа по email нет, зайти можно только через кабинет.
  renderBridgeFailed({
    onRetry: () => location.reload(),
    message: 'Откройте дневник из кабинета Гунсамбо — вкладка «Дневник».',
  });
} else {
  // staffEntry в сборке без emailLogin — вход наставника/админа по почте, без регистрации.
  renderAuthScreen(supabase, { onAuthenticated: () => location.reload(), allowSignup: FEATURES.emailLogin });
}

async function boot() {
  const store = new SupabaseStore(supabase);
  // Кабинет наставника — только для ролей mentor/admin. Не удалось узнать роль → обычный режим ученика.
  const mentorStore = new MentorStore(supabase);
  const role = await mentorStore.getMyRole().catch(() => 'student');
  await startApp(store, {
    mentorStore: role === 'mentor' || role === 'admin' ? mentorStore : null,
    onLogout: async () => {
      await supabase.auth.signOut();
      location.reload();
    },
  });
}
