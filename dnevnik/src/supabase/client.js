// Единая точка создания Supabase-клиента. Спецификатор '@supabase/supabase-js'
// резолвится по-разному в двух средах, без изменения кода:
//  - в браузере (index.html, без бандлера) — через <script type="importmap">
//    на CDN-сборку (см. index.html);
//  - в Node (npm test) — обычным способом из node_modules (пакет — dependency).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
