// Экран входа/регистрации. Рисуется вместо основного приложения, пока нет
// сессии Supabase. После успешного входа/регистрации — location.reload(),
// чтобы main.js заново прошёл bootstrap с уже готовой сессией (проще и
// надёжнее, чем разбирать/собирать DOM основного приложения на лету).
import { h, mount } from './dom.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{ onAuthenticated: () => void, initialError?: string, initialMode?: 'signin'|'signup'|'forgot', allowSignup?: boolean }} opts
 */
export function renderAuthScreen(client, { onAuthenticated, initialError = '', initialMode = 'signin', allowSignup = true }) {
  const $app = document.getElementById('app');
  $app.removeAttribute('data-loading');
  $app.className = 'auth-screen';

  let mode = initialMode; // 'signin' | 'signup' | 'forgot'
  let busy = false;
  let error = initialError;
  let notice = '';
  const values = { email: '', name: '' }; // чтобы при ошибке ввод не пропадал

  render();

  function render() {
    const isSignin = mode === 'signin';
    const isForgot = mode === 'forgot';
    mount(
      $app,
      h('div.auth-card.card', {}, [
        h('h1', { text: 'R-Дневник', style: 'font-size:18px;margin:0 0 4px;' }),
        h('p', {
          text: isForgot ? 'Восстановление пароля' : isSignin ? 'Вход в аккаунт' : 'Регистрация',
          style: 'color:var(--ink-2);margin:0 0 18px;font-size:13px;',
        }),
        h('form', { style: 'display:flex;flex-direction:column;gap:12px;', onsubmit: onSubmit }, [
          isSignin || isForgot ? null : h('div.field', {}, [
            h('label', { for: 'auth-name', text: 'Имя и фамилия' }),
            h('input', { id: 'auth-name', type: 'text', required: true, maxlength: 100, autocomplete: 'name', value: values.name }),
            h('div.hint', { text: 'Его увидит ваш наставник.' }),
          ]),
          isForgot ? h('div.hint', { text: 'Укажите email аккаунта — пришлём ссылку для установки нового пароля.' }) : null,
          h('div.field', {}, [
            h('label', { for: 'auth-email', text: 'Email' }),
            h('input', { id: 'auth-email', type: 'email', required: true, autocomplete: 'email', value: values.email }),
          ]),
          isForgot ? null : h('div.field', {}, [
            h('label', { for: 'auth-password', text: 'Пароль' }),
            h('input', {
              id: 'auth-password', type: 'password', required: true, minlength: 6,
              autocomplete: isSignin ? 'current-password' : 'new-password',
            }),
          ]),
          isSignin ? h('button.btn.btn-ghost', { type: 'button', id: 'auth-forgot', onclick: () => switchMode('forgot'), style: 'align-self:flex-start;padding:0;font-size:12.5px;' }, ['Забыли пароль?']) : null,
          error ? h('div', { text: error, style: 'color:var(--loss-ink);font-size:12.5px;' }) : null,
          notice ? h('div', { text: notice, style: 'color:var(--ink-2);font-size:12.5px;' }) : null,
          h('button.btn.btn-primary', { type: 'submit', disabled: busy, style: 'margin-top:6px;' }, [
            busy ? 'Подождите…' : isForgot ? 'Отправить ссылку' : isSignin ? 'Войти' : 'Зарегистрироваться',
          ]),
        ]),
        !allowSignup && isSignin ? null : h('button.btn.btn-ghost', { onclick: toggleMode, style: 'margin-top:12px;width:100%;' }, [
          isForgot ? 'Вернуться ко входу' : isSignin ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти',
        ]),
      ]),
    );
  }

  function switchMode(next) {
    mode = next;
    error = '';
    notice = '';
    render();
  }

  function toggleMode() {
    switchMode(mode === 'signin' ? 'signup' : 'signin');
  }

  async function onForgot(email) {
    values.email = email;
    busy = true;
    error = '';
    notice = '';
    render();
    try {
      const { error: err } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (err) throw err;
      notice = 'Если такой email зарегистрирован, мы отправили письмо со ссылкой. Проверьте почту, в том числе папку «Спам».';
    } catch (err) {
      error = translateAuthError(err.message);
    }
    busy = false;
    render();
  }

  async function onSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value.trim();
    if (mode === 'forgot') return onForgot(email);
    const password = document.getElementById('auth-password').value;
    const name = mode === 'signup' ? document.getElementById('auth-name').value.trim() : '';
    if (mode === 'signup' && !name) {
      error = 'Укажите имя — его увидит ваш наставник.';
      render();
      return;
    }
    values.email = email;
    values.name = name;
    busy = true;
    error = '';
    notice = '';
    render();
    try {
      if (mode === 'signin') {
        const { error: err } = await client.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onAuthenticated();
      } else {
        const { data, error: err } = await client.auth.signUp({ email, password, options: { data: { display_name: name } } });
        if (err) throw err;
        if (data.session) {
          onAuthenticated();
        } else {
          busy = false;
          notice = 'Проверьте почту — нужно подтвердить email, затем войдите.';
          mode = 'signin';
          render();
        }
      }
    } catch (err) {
      busy = false;
      error = translateAuthError(err.message);
      render();
    }
  }
}

/**
 * Экран «Новый пароль» — открывается по ссылке из письма восстановления
 * (Supabase к этому моменту уже создал временную сессию из ссылки).
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {{ onDone: () => void }} opts
 */
export function renderPasswordRecoveryScreen(client, { onDone }) {
  const $app = document.getElementById('app');
  $app.removeAttribute('data-loading');
  $app.className = 'auth-screen';

  let busy = false;
  let error = '';

  render();

  function render() {
    mount(
      $app,
      h('div.auth-card.card', {}, [
        h('h1', { text: 'R-Дневник', style: 'font-size:18px;margin:0 0 4px;' }),
        h('p', { text: 'Новый пароль', style: 'color:var(--ink-2);margin:0 0 18px;font-size:13px;' }),
        h('form', { style: 'display:flex;flex-direction:column;gap:12px;', onsubmit: onSubmit }, [
          h('div.field', {}, [
            h('label', { for: 'rec-password', text: 'Новый пароль' }),
            h('input', { id: 'rec-password', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' }),
          ]),
          h('div.field', {}, [
            h('label', { for: 'rec-password2', text: 'Повторите пароль' }),
            h('input', { id: 'rec-password2', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' }),
          ]),
          error ? h('div', { text: error, style: 'color:var(--loss-ink);font-size:12.5px;' }) : null,
          h('button.btn.btn-primary', { type: 'submit', disabled: busy, style: 'margin-top:6px;' }, [
            busy ? 'Подождите…' : 'Сохранить и войти',
          ]),
        ]),
      ]),
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    const password = document.getElementById('rec-password').value;
    const password2 = document.getElementById('rec-password2').value;
    if (password !== password2) {
      error = 'Пароли не совпадают.';
      render();
      return;
    }
    busy = true;
    error = '';
    render();
    try {
      const { error: err } = await client.auth.updateUser({ password });
      if (err) throw err;
      onDone();
    } catch (err) {
      busy = false;
      error = translateAuthError(err.message);
      render();
    }
  }
}

function translateAuthError(msg) {
  if (/invalid login credentials/i.test(msg)) return 'Неверный email или пароль.';
  if (/user already registered/i.test(msg)) return 'Такой email уже зарегистрирован — войдите.';
  if (/password.*at least/i.test(msg)) return 'Пароль слишком короткий (минимум 6 символов).';
  if (/different from the old password/i.test(msg)) return 'Новый пароль должен отличаться от прежнего.';
  if (/auth session missing|token has expired|jwt expired|otp_expired/i.test(msg)) return 'Ссылка устарела. Запросите восстановление пароля заново.';
  if (/rate limit|too many|only request this after/i.test(msg)) return 'Слишком много запросов. Подождите немного и попробуйте снова.';
  return msg;
}
