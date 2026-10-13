// Единая точка импорта ядра расчётов.
// UI и хранилище импортируют ТОЛЬКО отсюда: `import { computePlan, computeStats } from '../calc/index.js'`.
// Это граница, которая не изменится при переходе на Next.js + Supabase.

export * from './position.js';
export * from './trade.js';
export * from './stats.js';
