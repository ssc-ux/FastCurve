// Wrapper Tesseract.js — chargement 100% local (aucun appel réseau externe).
// Les assets (worker, core wasm, données de langue) sont servis depuis la même
// origine via public/tesseract/.

import { createWorker, type Worker } from 'tesseract.js';

export interface OcrWord {
  text: string;
  x0: number; y0: number; x1: number; y1: number;
  conf: number;
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
}

function assetBase(): string {
  // BASE_URL vaut './' ou '/<repo>/' — on résout en URL absolue robuste.
  const base = (import.meta as any).env?.BASE_URL ?? './';
  return new URL(base + 'tesseract/', location.href).href;
}

let workerPromise: Promise<Worker> | null = null;

export function initOcr(onProgress?: (p: number, status: string) => void): Promise<Worker> {
  if (workerPromise) return workerPromise;
  const base = assetBase();
  workerPromise = createWorker('fra', 1, {
    workerPath: base + 'worker.min.js',
    corePath: base,
    langPath: base,
    gzip: true,
    logger: (m: any) => {
      if (onProgress && typeof m.progress === 'number') onProgress(m.progress, m.status);
    },
  }).then(async (w) => {
    await w.setParameters({
      preserve_interword_spaces: '1',
      // 6 = bloc de texte uniforme ; bon compromis pour un tableau.
      tessedit_pageseg_mode: '6' as any,
    });
    return w;
  });
  return workerPromise;
}

export async function runOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number, status: string) => void,
): Promise<OcrResult> {
  const worker = await initOcr(onProgress);
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const words: OcrWord[] = [];
  const anyData = data as any;
  const collect = (w: any) => {
    if (!w || !w.bbox) return;
    words.push({
      text: (w.text || '').trim(),
      x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
      conf: typeof w.confidence === 'number' ? w.confidence : 0,
    });
  };
  // Tesseract v7 : parcours blocks → paragraphs → lines → words
  if (Array.isArray(anyData.blocks)) {
    for (const b of anyData.blocks) {
      for (const par of b.paragraphs || []) {
        for (const ln of par.lines || []) {
          for (const w of ln.words || []) collect(w);
        }
      }
    }
  }
  // Repli : certains builds exposent data.words directement
  if (!words.length && Array.isArray(anyData.words)) {
    for (const w of anyData.words) collect(w);
  }
  return { text: data.text || '', words: words.filter(w => w.text.length > 0) };
}

/**
 * Relecture ciblée d'une PETITE zone (une cellule) en mode « ligne unique ».
 * Renvoie les mots avec leurs positions, pour que l'appelant puisse choisir le
 * bon token et rejeter les lectures tronquées au bord de la découpe.
 */
export async function runOcrCell(canvas: HTMLCanvasElement): Promise<OcrWord[]> {
  const worker = await initOcr();
  await worker.setParameters({ tessedit_pageseg_mode: '7' as any });
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    const words: OcrWord[] = [];
    const anyData = data as any;
    const collect = (w: any) => {
      if (!w || !w.bbox) return;
      words.push({
        text: (w.text || '').trim(),
        x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
        conf: typeof w.confidence === 'number' ? w.confidence : 0,
      });
    };
    if (Array.isArray(anyData.blocks)) {
      for (const b of anyData.blocks) {
        for (const par of b.paragraphs || []) {
          for (const ln of par.lines || []) {
            for (const w of ln.words || []) collect(w);
          }
        }
      }
    }
    return words.filter(w => w.text.length > 0);
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: '6' as any });
  }
}

/** Préchauffe le worker OCR en tâche de fond (le 1er import paraît instantané). */
export function preheatOcr() {
  try { initOcr(); } catch { /* silencieux : le préchauffage est best-effort */ }
}

export async function terminateOcr() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
