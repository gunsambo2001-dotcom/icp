// Реальная точка входа приложения (см. index.html). Решает, показывать ли
// экран входа или сразу приложение, и на каком store оно работает —
// ui/app.js про это ничего не знает (см. комментарий в его начале).
import { supabase } from '../supabase/client.js';
import { SupabaseStore } from '../store/supabase-store.js';
import { MentorStore } from '../store/mentor-store.js';
import { startApp } from './app.js';
import { renderAuthScreen, renderPasswordRecoveryScreen } from './auth.js';

// Ссылка из письма «Забыли пароль?» приходит как #...&type=recovery. Supabase сам создаёт по ней
// сессию, поэтому без этой проверки человек молча оказался бы внутри без установки нового пароля.
let isRecovery = /[#&]type=recovery/.test(location.hash);
const linkFailed = /[#&](error_code=otp_expired|error=access_denied)/.test(location.hash);
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') isRecovery = true;
});

const { data: { session } } = await supabase.auth.getSession();
if (isRecovery && session) {
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
} else {
  renderAuthScreen(supabase, { onAuthenticated: () => location.reload() });
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
