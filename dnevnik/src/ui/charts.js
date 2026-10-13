// SVG-графики. Чистое представление: на вход — уже посчитанные ряды из calc/stats.
import { usd, dateShort, rMult, num } from './format.js';
import { esc } from './dom.js';

const SVGNS = 'http://www.w3.org/2000/svg';
let tipEl;

function tip() {
  tipEl ||= document.getElementById('tooltip');
  return tipEl;
}
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  let left = x + 14;
  let top = y - r.height - 10;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top < 8) top = y + 18;
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}
export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

function el(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** Кривая капитала. points: [{date, equity, trade?}] */
export function equityChart(points, startBalance) {
  const W = 760;
  const H = 250;
  const pl = 58;
  const pr = 16;
  const pt = 14;
  const pb = 26;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Кривая капитала' });

  if (points.length < 2) {
    svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'tick-label' })).textContent =
      'Недостаточно данных';
    return wrap(svg);
  }

  const xs = (i) => pl + (i / (points.length - 1)) * (W - pl - pr);
  const vals = points.map((p) => p.equity);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || 100;
  lo -= pad;
  hi += pad;
  const ys = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);

  for (let i = 0; i <= 4; i++) {
    const v = lo + (i / 4) * (hi - lo);
    const y = ys(v);
    svg.appendChild(el('line', { class: 'gridline', x1: pl, y1: y, x2: W - pr, y2: y }));
    const t = el('text', { class: 'tick-label', x: pl - 8, y: y + 3, 'text-anchor': 'end' });
    t.textContent = `$${Math.round(v).toLocaleString('ru-RU')}`;
    svg.appendChild(t);
  }

  const up = points.at(-1).equity >= startBalance;
  const col = up ? 'var(--profit)' : 'var(--loss)';
  const baseY = ys(startBalance);
  svg.appendChild(el('line', { class: 'baseline', x1: pl, y1: baseY, x2: W - pr, y2: baseY }));

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.equity).toFixed(1)}`).join(' ');
  const area = `M${xs(0).toFixed(1)},${baseY.toFixed(1)} ${points
    .map((p, i) => `L${xs(i).toFixed(1)},${ys(p.equity).toFixed(1)}`)
    .join(' ')} L${xs(points.length - 1).toFixed(1)},${baseY.toFixed(1)} Z`;
  svg.appendChild(el('path', { d: area, fill: col, 'fill-opacity': '0.1' }));
  svg.appendChild(el('path', { d: line, fill: 'none', stroke: col, 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  const last = points.length - 1;
  svg.appendChild(el('circle', { cx: xs(last), cy: ys(points[last].equity), r: 4.5, fill: col, stroke: 'var(--chart-surface)', 'stroke-width': '2' }));

  // подписи месяцев
  const seen = new Set();
  points.forEach((p, i) => {
    if (!p.date) return;
    const m = p.date.slice(0, 7);
    if (seen.has(m)) return;
    seen.add(m);
    const t = el('text', { class: 'tick-label', x: xs(i), y: H - 6, 'text-anchor': 'middle' });
    t.textContent = dateShort(p.date).split(' ')[1] || '';
    svg.appendChild(t);
  });

  // hover
  const step = (W - pl - pr) / (points.length - 1);
  points.forEach((p, i) => {
    if (i === 0) return;
    const rect = el('rect', { x: xs(i) - step / 2, y: pt, width: step, height: H - pt - pb, fill: 'transparent' });
    rect.style.cursor = 'crosshair';
    rect.addEventListener('mousemove', (e) => {
      const tr = p.trade;
      showTip(
        `<div class="tt-title">${dateShort(p.date)}${tr ? ` · ${esc(tr.symbol)}` : ''}</div>
         <div class="tt-row"><span>Капитал</span><b>${usd(p.equity)}</b></div>
         ${tr ? `<div class="tt-row"><span>Сделка</span><b class="${tr.pnl >= 0 ? 'pos-text' : 'neg-text'}">${usd(tr.pnl, { sign: true })} · ${rMult(tr.rMultiple)}</b></div>` : ''}`,
        e.clientX, e.clientY,
      );
    });
    rect.addEventListener('mouseleave', hideTip);
    svg.appendChild(rect);
  });

  return wrap(svg);
}

/** P&L по дням. data: [{date, pnl}] */
export function dailyPnlChart(data) {
  const W = 760;
  const H = 210;
  const pl = 52;
  const pr = 12;
  const pt = 12;
  const pb = 24;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'P&L по дням' });
  if (!data.length) return wrap(svg);

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl))) * 1.1 || 1;
  const step = (W - pl - pr) / data.length;
  const bw = Math.min(22, step - 4);
  const zeroY = pt + (H - pt - pb) / 2;
  const ys = (v) => zeroY - (v / maxAbs) * ((H - pt - pb) / 2);

  [maxAbs, maxAbs / 2, 0, -maxAbs / 2, -maxAbs].forEach((v) => {
    const y = ys(v);
    svg.appendChild(el('line', { class: 'gridline', x1: pl, y1: y, x2: W - pr, y2: y }));
    const t = el('text', { class: 'tick-label', x: pl - 8, y: y + 3, 'text-anchor': 'end' });
    t.textContent = v === 0 ? '0' : usd(v, { sign: true });
    svg.appendChild(t);
  });
  svg.appendChild(el('line', { class: 'baseline', x1: pl, y1: zeroY, x2: W - pr, y2: zeroY }));

  data.forEach((d, i) => {
    const cx = pl + i * step + step / 2;
    const y0 = ys(0);
    const y1 = ys(d.pnl);
    const top = Math.min(y0, y1);
    const hgt = Math.max(1.5, Math.abs(y1 - y0));
    const rect = el('rect', {
      x: cx - bw / 2, y: top, width: bw, height: hgt, rx: Math.min(4, hgt),
      fill: d.pnl >= 0 ? 'var(--profit)' : 'var(--loss)',
    });
    rect.style.cursor = 'pointer';
    rect.addEventListener('mousemove', (e) =>
      showTip(
        `<div class="tt-title">${dateShort(d.date)}</div><div class="tt-row"><span>P&L дня</span><b class="${d.pnl >= 0 ? 'pos-text' : 'neg-text'}">${usd(d.pnl, { sign: true })}</b></div>`,
        e.clientX, e.clientY,
      ),
    );
    rect.addEventListener('mouseleave', hideTip);
    svg.appendChild(rect);
    if (i % Math.ceil(data.length / 12) === 0) {
      const t = el('text', { class: 'tick-label', x: cx, y: H - 6, 'text-anchor': 'middle' });
      t.textContent = dateShort(d.date);
      svg.appendChild(t);
    }
  });
  return wrap(svg);
}

/** Гистограмма распределения R. buckets: [{label, n, isWin}] */
export function rDistChart(buckets) {
  const W = 440;
  const H = 220;
  const pl = 28;
  const pr = 12;
  const pt = 16;
  const pb = 42;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Распределение R' });
  const maxN = Math.max(1, ...buckets.map((b) => b.n));
  const step = (W - pl - pr) / buckets.length;
  const bw = Math.min(46, step - 12);
  const ys = (n) => pt + (1 - n / maxN) * (H - pt - pb);

  for (let i = 0; i <= maxN; i++) {
    const y = ys(i);
    svg.appendChild(el('line', { class: 'gridline', x1: pl, y1: y, x2: W - pr, y2: y }));
    const t = el('text', { class: 'tick-label', x: pl - 6, y: y + 3, 'text-anchor': 'end' });
    t.textContent = i;
    svg.appendChild(t);
  }
  svg.appendChild(el('line', { class: 'baseline', x1: pl, y1: ys(0), x2: W - pr, y2: ys(0) }));

  buckets.forEach((b, i) => {
    const cx = pl + i * step + step / 2;
    const y = ys(b.n);
    const hgt = Math.max(1.5, ys(0) - y);
    svg.appendChild(el('rect', { x: cx - bw / 2, y, width: bw, height: hgt, rx: 4, fill: b.isWin ? 'var(--profit)' : 'var(--loss)' }));
    if (b.n > 0) {
      const t = el('text', { class: 'axis-label', x: cx, y: y - 5, 'text-anchor': 'middle', 'font-weight': '600' });
      t.textContent = b.n;
      svg.appendChild(t);
    }
    const lt = el('text', { class: 'tick-label', x: cx, y: H - 24, 'text-anchor': 'middle' });
    lt.textContent = b.label;
    svg.appendChild(lt);
  });
  const l = el('text', { class: 'axis-label', x: pl, y: H - 6 });
  l.textContent = 'убыточные';
  const r = el('text', { class: 'axis-label', x: W - pr, y: H - 6, 'text-anchor': 'end' });
  r.textContent = 'прибыльные';
  svg.append(l, r);
  return wrap(svg);
}

/** Мини-график сделки для карточки: свечи + зоны + ценники TP1/TP2/TP3. */
export function tradeMiniChart(t) {
  const W = 660;
  const H = 210;
  const stop = t.initialStop ?? t.stop;
  const targets = [t.tp1, t.tp2, t.tp3 ?? t.target].filter((x) => x != null && x > 0);
  const finalT = targets.length ? targets[targets.length - 1] : null;
  const all = [t.entry, stop, ...targets].filter((x) => x > 0);
  const hi = Math.max(...all) * 1.002;
  const lo = Math.min(...all) * 0.998;
  const ys = (v) => 14 + (1 - (v - lo) / (hi - lo)) * (H - 40);
  const rightX = W - 78;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;background:#0c0f14;">`;
  s += `<text x="12" y="14" fill="#8b95a3" style="font-size:11px;font-family:'IBM Plex Mono',monospace;">${esc(t.symbol)} · ${esc(t.timeframe || '1h')}${t.exchange ? ' · ' + esc(t.exchange) : ''}</text>`;

  const yE = ys(t.entry);
  const yS = ys(stop);
  s += `<rect x="12" y="${Math.min(yE, yS).toFixed(1)}" width="${rightX - 12}" height="${Math.abs(yE - yS).toFixed(1)}" fill="var(--loss)" fill-opacity="0.13"/>`;
  if (finalT != null) {
    const yF = ys(finalT);
    s += `<rect x="12" y="${Math.min(yE, yF).toFixed(1)}" width="${rightX - 12}" height="${Math.abs(yE - yF).toFixed(1)}" fill="var(--profit)" fill-opacity="0.13"/>`;
  }

  const n = 32;
  const cw = (rightX - 24) / n;
  let px = t.entry * (t.direction === 'long' ? 1.003 : 0.997);
  for (let i = 0; i < n; i++) {
    const drift = (i / n) * (t.entry - px) * 0.9;
    const o = px + drift + Math.sin(i * 1.3) * (hi - lo) * 0.04;
    const c = o + Math.cos(i * 0.9) * (hi - lo) * 0.05;
    const hh = Math.max(o, c) + (hi - lo) * 0.02;
    const ll = Math.min(o, c) - (hi - lo) * 0.02;
    const x = 12 + i * cw;
    const col = c >= o ? 'var(--profit)' : 'var(--loss)';
    s += `<line x1="${(x + cw / 2).toFixed(1)}" y1="${ys(hh).toFixed(1)}" x2="${(x + cw / 2).toFixed(1)}" y2="${ys(ll).toFixed(1)}" stroke="${col}" stroke-width="1"/>`;
    s += `<rect x="${x.toFixed(1)}" y="${ys(Math.max(o, c)).toFixed(1)}" width="${(cw * 0.62).toFixed(1)}" height="${Math.max(1, Math.abs(ys(o) - ys(c))).toFixed(1)}" fill="${col}"/>`;
  }

  const pill = (y, v, c) =>
    `<rect x="${rightX}" y="${(y - 9).toFixed(1)}" width="72" height="18" rx="3" fill="${c}"/><text x="${rightX + 36}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#fff" style="font-size:10px;font-family:'IBM Plex Mono',monospace;">${num(v)}</text>`;

  s += `<line x1="12" y1="${yE.toFixed(1)}" x2="${rightX}" y2="${yE.toFixed(1)}" stroke="#c9d1d9" stroke-width="1" stroke-dasharray="4 3"/>`;
  s += `<line x1="12" y1="${yS.toFixed(1)}" x2="${rightX}" y2="${yS.toFixed(1)}" stroke="var(--loss)" stroke-width="1"/>`;
  s += pill(yS, stop, '#b3352f') + pill(yE, t.entry, '#3a4048');
  targets.forEach((tp) => {
    const y = ys(tp);
    s += `<line x1="12" y1="${y.toFixed(1)}" x2="${rightX}" y2="${y.toFixed(1)}" stroke="var(--profit)" stroke-width="1" stroke-opacity="0.7"/>`;
    s += pill(y, tp, '#1a7f37');
  });
  s += '</svg>';
  return s;
}

function wrap(svg) {
  const d = document.createElement('div');
  d.className = 'chart';
  d.appendChild(svg);
  return d;
}
