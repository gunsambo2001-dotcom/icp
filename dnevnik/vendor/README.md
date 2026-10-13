Локальные копии библиотек (чтобы сайт не зависел от CDN, заблокированного в РФ).
Пересборка после обновления версий (из папки r-journal):
- supabase-js: node node_modules/esbuild/bin/esbuild node_modules/@supabase/supabase-js/dist/index.mjs --bundle --format=esm --platform=browser --minify --outfile=vendor/supabase-js.js
- tesseract: vendor/tesseract.js — обёртка с именованными экспортами (не трогать); скопировать node_modules/tesseract.js/dist/tesseract.esm.min.js, dist/worker.min.js и tesseract.js-core/tesseract-core{,-simd,-relaxedsimd}-lstm.wasm.js (воркер и ядро — в vendor/tesseract/)
