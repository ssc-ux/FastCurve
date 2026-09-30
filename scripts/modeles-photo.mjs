// Copie les modèles PaddleOCR et le moteur ONNX Runtime (WebAssembly) dans
// public/ avant dev et build. Rien n'est versionné : tout vient de node_modules.
import { cpSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';

const nm = new URL('../node_modules/', import.meta.url);
const pub = new URL('../public/', import.meta.url);
mkdirSync(new URL('paddle/', pub), { recursive: true });
mkdirSync(new URL('ort/', pub), { recursive: true });

// Détection PP-OCRv4 (multilingue) + reconnaissance PP-OCRv4 latine.
cpSync(new URL('@gutenye/ocr-models/assets/ch_PP-OCRv4_det_infer.onnx', nm), new URL('paddle/ch_PP-OCRv4_det_infer.onnx', pub));
cpSync(new URL('paddle-ocr-onnx-models/models/en_PP-OCRv4_rec.onnx', nm), new URL('paddle/en_PP-OCRv4_rec.onnx', pub));
// Dictionnaire latin de PaddleOCR (en_dict) : ASCII 48-126 puis 33-47.
const car = [];
for (let c = 48; c < 127; c++) car.push(String.fromCharCode(c));
for (let c = 33; c < 48; c++) car.push(String.fromCharCode(c));
writeFileSync(new URL('paddle/en_dict.txt', pub), car.join('\n') + '\n');

// Moteur WebAssembly d'ONNX Runtime (variante sans fils d'exécution multiples).
const dist = new URL('onnxruntime-web/dist/', nm);
for (const f of readdirSync(dist)) {
  if (/^ort-wasm-simd-threaded\.(mjs|wasm)$/.test(f)) cpSync(new URL(f, dist), new URL('ort/' + f, pub));
}
console.log('Modèles photo prêts dans public/paddle et public/ort.');
