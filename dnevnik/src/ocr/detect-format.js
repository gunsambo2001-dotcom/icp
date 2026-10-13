// Выбор профиля обработки под конкретный скриншот. Отдельный заменяемый
// модуль намеренно: сейчас это просто соотношение сторон (альбомная =
// desktop, портретная = mobile), но если позже появятся более надёжные
// признаки (расположение конкретных элементов интерфейса TradingView,
// логотип биржи и т.п.) — меняется только этот файл, pipeline/profiles не
// трогаются.
import { PROFILES } from './profiles/index.js';

/**
 * @param {number} width
 * @param {number} height
 * @returns {{ profile: import('./profiles/index.js').OcrProfile, formatConfident: boolean, scores: Record<string, number> }}
 */
export function detectFormat(width, height) {
  const scored = PROFILES.map((p) => ({ profile: p, score: p.matchScore(width, height) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];

  // Уверены в выборе формата, только если лучший профиль явно впереди
  // второго (не «оба чуть-чуть подошли» и не «оба вообще не подошли»).
  const formatConfident = best.score > 0 && best.score - (runnerUp?.score ?? 0) >= 0.5;

  return {
    profile: best.profile,
    formatConfident,
    scores: Object.fromEntries(scored.map((s) => [s.profile.name, s.score])),
  };
}
