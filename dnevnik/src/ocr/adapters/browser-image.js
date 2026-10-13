// Адаптер изображения для браузера (реальный экран загрузки скриншота в
// приложении). Тот же интерфейс, что у adapters/node-image.js — pipeline/*
// работает одинаково в обеих средах.
/** @param {HTMLImageElement} imgEl — уже загруженный (onload/decode прошёл) */
export function loadBrowserImage(imgEl) {
  const width = imgEl.naturalWidth, height = imgEl.naturalHeight;
  const full = document.createElement('canvas');
  full.width = width; full.height = height;
  const fullCtx = full.getContext('2d');
  fullCtx.drawImage(imgEl, 0, 0);
  const pixels = fullCtx.getImageData(0, 0, width, height).data;

  return {
    width,
    height,
    getPixel(x, y) {
      const idx = (y * width + x) * 4;
      return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
    },
    async cropDataUrl(x, y, w, h, scale = 5) {
      const c = document.createElement('canvas');
      c.width = w * scale; c.height = h * scale;
      const ctx = c.getContext('2d');
      ctx.drawImage(imgEl, x, y, w, h, 0, 0, w * scale, h * scale);
      return c.toDataURL('image/png');
    },
    async fullDataUrl() {
      return full.toDataURL('image/png');
    },
  };
}
