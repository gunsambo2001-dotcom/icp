// Реестр профилей. Добавить новый формат скриншота (планшет, другая биржа,
// другой клиент) — создать profiles/<name>.js с той же формой (name,
// matchScore, пороги ниже) и добавить сюда. Остальной OCR-модуль трогать не
// нужно — pipeline/* от профиля не зависит, только читает его настройки.
import desktop from './desktop.js';
import mobile from './mobile.js';

/**
 * @typedef {Object} OcrProfile
 * @property {string} name
 * @property {(width:number, height:number) => number} matchScore — 0..1
 * @property {number} searchFromPct
 * @property {number} chromaMin
 * @property {number} brightMin
 * @property {number} minRunPx
 * @property {number} maxRunPx
 * @property {number} normalHeightMin
 * @property {number} normalHeightMax
 */

/** @type {OcrProfile[]} */
export const PROFILES = [desktop, mobile];
