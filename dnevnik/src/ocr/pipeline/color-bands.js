// Поиск цветных плашек-меток (Entry/Stop/Target) в правой части скриншота.
// Чистая функция поверх абстрактного доступа к пикселям ({width, height,
// getPixel(x,y)}) — не зависит от Canvas (браузер) или Jimp (Node/тесты),
// поэтому работает одинаково в обеих средах. Пороги приходят из профиля
// (profiles/desktop.js, profiles/mobile.js) — сам алгоритм для всех один.
import { classifyColor } from './classify-color.js';

const MERGE_GAP = 6; // слить соседние полосы одного бакета с маленьким разрывом (антиалиасинг на стыке цветов)

/**
 * @param {{width:number, height:number, getPixel:(x:number,y:number)=>[number,number,number]}} image
 * @param {import('../profiles/index.js').OcrProfile} profile
 * @returns {Array<{bucket:string, x0:number,x1:number,y0:number,y1:number, heightPx:number, color:[number,number,number]}>}
 */
export function findColorBands(image, profile) {
  const { width: w, height: h, getPixel } = image;
  const { searchFromPct, chromaMin, brightMin, minRunPx, maxRunPx } = profile;
  const stripXStart = Math.floor(w * (searchFromPct / 100));

  const rows = [];
  for (let y = 0; y < h; y++) {
    let bestRun = 0, bestStart = 0, curRun = 0, curStart = 0;
    let curSum = [0, 0, 0], bestSum = [0, 0, 0];
    for (let x = stripXStart; x < w; x++) {
      const [r, g, b] = getPixel(x, y);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const bright = (r + g + b) / 3;
      const passes = (max - min) > chromaMin && bright > brightMin;
      if (passes) {
        if (curRun === 0) curStart = x;
        curRun++; curSum[0] += r; curSum[1] += g; curSum[2] += b;
        if (curRun > bestRun) { bestRun = curRun; bestStart = curStart; bestSum = [...curSum]; }
      } else { curRun = 0; curSum = [0, 0, 0]; }
    }
    const colored = bestRun >= minRunPx && bestRun <= maxRunPx;
    const bucket = colored ? classifyColor(bestSum[0] / bestRun, bestSum[1] / bestRun, bestSum[2] / bestRun) : null;
    rows.push({ y, colored, bucket, xStart: bestStart, xEnd: bestStart + bestRun, sum: bestSum, run: bestRun });
  }

  // Разрываем полосу не только на некрашеных строках, но и при смене бакета —
  // вплотную стоящие разноцветные плашки (Entry/Stop/Target бывают без
  // чёрного зазора между собой) иначе слились бы в одну.
  const bands = [];
  let cur = null;
  for (const row of rows) {
    if (row.colored) {
      if (!cur || cur.bucket !== row.bucket) {
        if (cur) bands.push(cur);
        cur = { bucket: row.bucket, y0: row.y, y1: row.y, xMin: row.xStart, xMax: row.xEnd, rSum: row.sum[0], gSum: row.sum[1], bSum: row.sum[2], n: row.run };
      } else {
        cur.y1 = row.y;
        cur.xMin = Math.min(cur.xMin, row.xStart);
        cur.xMax = Math.max(cur.xMax, row.xEnd);
        cur.rSum += row.sum[0]; cur.gSum += row.sum[1]; cur.bSum += row.sum[2]; cur.n += row.run;
      }
    } else if (cur) { bands.push(cur); cur = null; }
  }
  if (cur) bands.push(cur);

  const merged = [];
  for (const b of bands) {
    const last = merged[merged.length - 1];
    if (last && last.bucket === b.bucket && (b.y0 - last.y1) <= MERGE_GAP) {
      last.y1 = b.y1;
      last.xMin = Math.min(last.xMin, b.xMin);
      last.xMax = Math.max(last.xMax, b.xMax);
      last.rSum += b.rSum; last.gSum += b.gSum; last.bSum += b.bSum; last.n += b.n;
    } else merged.push({ ...b });
  }

  const PAD = 4;
  return merged
    .filter((b) => (b.y1 - b.y0) >= 4)
    .map((b) => ({
      bucket: b.bucket,
      x0: Math.max(0, b.xMin - PAD), x1: Math.min(w, b.xMax + PAD),
      y0: Math.max(0, b.y0 - 2), y1: Math.min(h, b.y1 + 2),
      heightPx: (b.y1 - b.y0) + 4,
      color: [Math.round(b.rSum / b.n), Math.round(b.gSum / b.n), Math.round(b.bSum / b.n)],
    }));
}
