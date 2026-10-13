// Точка входа ТОЛЬКО для локальной проверки в браузере (dev.html) — без
// Supabase, без сети, без риска что-то записать в реальный проект. Данные
// живут в localStorage вкладки (LocalStore), как в демо-режиме. Не
// подключать из index.html/main.js — это отдельный вход для ручного теста.
// Кабинет наставника здесь — на поддельном MentorStore с выдуманными учениками
// (см. dev-mentor-store.js), чтобы посмотреть экран без роли admin в живой базе.
import { LocalStore } from '../store/local-store.js';
import { startApp } from './app.js';
import { createFakeMentorStore } from './dev-mentor-store.js';

await startApp(new LocalStore(), { mentorStore: createFakeMentorStore() });
