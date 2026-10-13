// Адаптер изображения для Node (тесты/скрипты, ocr-test/*). Даёт pipeline/*
// доступ к пикселям и вырезанным кусочкам через тот же интерфейс, что и
// браузерный адаптер (adapters/browser-image.js) — сам pipeline о Jimp
// ничего не знает.
import { Jimp } from 'jimp';

/** @param {string} path */
export async function loadNodeImage(path) {
  const img = await Jimp.read(path);
  const width = img.bitmap.width, height = img.bitmap.height;
  const { data } = img.bitmap;

  return {
    width,
    height,
    getPixel(x, y) {
      const idx = (y * width + x) * 4;
      return [data[idx], data[idx + 1], data[idx + 2]];
    },
    async cropDataUrl(x, y, w, h, scale = 5) {
      const crop = img.clone().crop({ x, y, w, h }).resize({ w: w * scale, h: h * scale });
      return await crop.getBase64('image/png');
    },
    /** Только для Node: полный скриншот как data URL — для распознавания заголовка целиком. */
    async fullDataUrl() {
      return await img.getBase64('image/png');
    },
  };
}
