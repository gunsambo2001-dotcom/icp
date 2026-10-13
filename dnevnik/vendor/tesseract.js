// Обёртка: dist-файл tesseract.js отдаёт только default, а приложение делает
// `import { createWorker } from 'tesseract.js'`. Пробрасываем нужные именованные экспорты.
import T from './tesseract.esm.min.js';
export const createWorker = T.createWorker;
export const createScheduler = T.createScheduler;
export const OEM = T.OEM;
export const PSM = T.PSM;
export default T;
