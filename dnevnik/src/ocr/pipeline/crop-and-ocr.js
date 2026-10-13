// Вырезать плашку, увеличить, прогнать через уже настроенный Tesseract-воркер
// (только цифры — см. index.js). Работает с любым адаптером изображения
// (Node/Jimp или браузер/Canvas), которому нужен только метод cropDataUrl.
//
// НАХОДКА С ТЕСТА НА INJ: плашка Target вырезалась ПОЛНОСТЬЮ и корректно
// («5,711» целиком видно на кропе), но при апскейле x5 Tesseract на этом
// конкретном кропе стабильно возвращал только «5» (во всех PSM-режимах,
// confidence 0 — верный признак, что дело не в качестве текста, а в
// недостаточном разрешении для сегментации символов). x8 чинит INJ, но
// портит другой скриншот (ETH Entry на x8/x9 теряет запятую-разделитель,
// хотя на x5/x6/x7 читает её верно) — x7 единственный апскейл, на котором
// одновременно верно читаются ОБА кропа на всех 5 тестовых скриншотах.
const UPSCALE = 7;

/**
 * @param {{cropDataUrl:(x:number,y:number,w:number,h:number,scale:number)=>Promise<string>}} image
 * @param {import('tesseract.js').Worker} worker — уже с setParameters под цифры
 * @param {{x0:number,x1:number,y0:number,y1:number}} band
 */
export async function ocrBand(image, worker, band) {
  const w = band.x1 - band.x0, h = band.y1 - band.y0;
  const dataUrl = await image.cropDataUrl(band.x0, band.y0, w, h, UPSCALE);
  const { data } = await worker.recognize(dataUrl);
  return {
    rawText: (data.text ?? '').trim(),
    ocrConfidence: data.confidence ?? 0, // 0..100, отдаёт сам Tesseract
    cropDataUrl: dataUrl, // для экрана проверки — показать ученику, что вырезали
  };
}
