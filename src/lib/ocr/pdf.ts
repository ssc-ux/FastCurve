// Rendu local d'un PDF en images (une par page) pour l'OCR.
// 100% dans le navigateur : pdf.js est bundlé (chargé à la demande), aucun réseau.

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// Chargement paresseux : pdf.js (~500 Ko) n'est téléchargé que si on ouvre un PDF.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Vite bundle le worker et fournit une URL same-origin (conforme à la CSP).
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export interface PdfRender {
  canvases: HTMLCanvasElement[];
  /** Nombre total de pages du PDF (peut dépasser le nombre rendu). */
  total: number;
}

/** Rend les pages d'un PDF en canvases (scale ~2 pour un OCR net). */
export async function pdfToCanvases(file: File, maxPages = 20, scale = 2): Promise<PdfRender> {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const total = doc.numPages;
  const canvases: HTMLCanvasElement[] = [];
  const n = Math.min(total, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }
  try { await doc.destroy(); } catch { /* ignore */ }
  return { canvases, total };
}

/** Convertit un canvas en HTMLImageElement (pour réutiliser le pipeline image). */
export function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = canvas.toDataURL('image/png');
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
}
