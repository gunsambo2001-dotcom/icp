// Публичные параметры проекта Supabase. Publishable key безопасен на клиенте
// (аналог старого anon key) — реальная защита данных на стороне БД через RLS
// (см. r-journal/supabase/schema.sql), не через секретность этого ключа.
// Идёт через прокси Cloudflare (r-journal/cloudflare-proxy/worker.js), чтобы работало
// без VPN там, где supabase.co заблокирован. Прямой адрес: https://zmkbkmjxyqokyzmkqdrg.supabase.co
// Основной адрес — прокси, запасной — прямой. Клиент на старте проверяет оба
// (см. client.js) и ходит в тот, что ответил: *.workers.dev периодически рвёт
// соединение, а supabase.co в части сетей закрыт — так работает хотя бы один.
export const SUPABASE_URL = 'https://supabase-proxy.erygdenov.workers.dev';
export const SUPABASE_URL_DIRECT = 'https://zmkbkmjxyqokyzmkqdrg.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4FbP7zqHbds5xBBukyppiA_wq3mxmDJ';
