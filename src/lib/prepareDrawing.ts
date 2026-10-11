/**
 * Prepares an uploaded drawing for AI analysis.
 *
 * The original file is always stored untouched (the viewer renders that), but
 * what we send to /api/analyze-drawing is normalised first:
 *
 *  - PDFs are rasterised to a single JPEG page. Sending a vector PDF makes
 *    Gemini far slower to respond, which is what pushed the serverless
 *    function past its time limit on real drawings.
 *  - Oversized rasters are downscaled.
 *
 * Both keep the request well inside Vercel's 4.5MB body cap while preserving
 * enough resolution to read small service-room labels.
 */

/** Longest edge sent to the AI. Plenty for label legibility, far cheaper than a full-res sheet. */
const MAX_EDGE_PX = 2200;
/** JPEG quality: line drawings stay crisp well below 1.0. */
const JPEG_QUALITY = 0.92;
/** Hard ceiling on the encoded payload (Vercel caps the request body at 4.5MB). */
const MAX_PAYLOAD_BYTES = 3.6 * 1024 * 1024;

export interface PreparedDrawing {
  /** Data URL ("data:image/jpeg;base64,...") to hand to the API. */
  dataUrl: string;
  mimeType: string;
  /** Set when the drawing was converted or shrunk, for logging/telemetry. */
  note?: string;
}

const isPdf = (file: File) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  // Re-encode at falling quality if the first pass is too big for the body cap.
  for (const q of [JPEG_QUALITY, 0.82, 0.7, 0.6]) {
    const url = canvas.toDataURL("image/jpeg", q);
    // base64 is ~4/3 of the byte length.
    if ((url.length * 3) / 4 <= MAX_PAYLOAD_BYTES) return url;
  }
  return canvas.toDataURL("image/jpeg", 0.5);
}

/** Scale factor that brings the longest edge down to MAX_EDGE_PX (never upscales). */
const fitScale = (w: number, h: number) => Math.min(1, MAX_EDGE_PX / Math.max(w, h));

/** Renders page 1 of a PDF to a JPEG data URL. */
async function pdfToImage(file: File): Promise<PreparedDrawing> {
  const pdfjsLib = await import("pdfjs-dist");
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    // Render above the target then let fitScale trim it, so thin linework and
    // small text survive rasterisation instead of aliasing away.
    const scale = Math.min(3, Math.max(1.5, MAX_EDGE_PX / Math.max(base.width, base.height)));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D canvas context.");

    // Flatten onto white: PDFs are transparent, and JPEG has no alpha.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const pageCount = doc.numPages;
    const note =
      `PDF page 1 rasterised to ${canvas.width}x${canvas.height} JPEG` +
      (pageCount > 1 ? ` (${pageCount} pages; only page 1 is analysed)` : "");

    return { dataUrl: canvasToDataUrl(shrinkToFit(canvas)), mimeType: "image/jpeg", note };
  } finally {
    doc.destroy();
  }
}

/** Downscales a canvas in place-ish (returns a new canvas) if it exceeds MAX_EDGE_PX. */
function shrinkToFit(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const scale = fitScale(canvas.width, canvas.height);
  if (scale === 1) return canvas;

  const out = document.createElement("canvas");
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/** Downscales / re-encodes a raster image when it is larger than we need. */
async function imageToPayload(file: File): Promise<PreparedDrawing> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = fitScale(bitmap.width, bitmap.height);
    const alreadySmallEnough = scale === 1 && file.size <= MAX_PAYLOAD_BYTES;

    if (alreadySmallEnough) {
      return { dataUrl: await fileToDataUrl(file), mimeType: file.type || "image/png" };
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl: await fileToDataUrl(file), mimeType: file.type || "image/png" };

    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    return {
      dataUrl: canvasToDataUrl(canvas),
      mimeType: "image/jpeg",
      note: `Image resized ${bitmap.width}x${bitmap.height} -> ${canvas.width}x${canvas.height} for analysis`,
    };
  } finally {
    bitmap.close();
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}

/**
 * Normalises any supported drawing into a compact JPEG/PNG data URL for the AI.
 * Falls back to the raw file if conversion fails, so a browser quirk degrades
 * rather than blocking the upload outright.
 */
export async function prepareDrawingForAnalysis(file: File): Promise<PreparedDrawing> {
  try {
    return isPdf(file) ? await pdfToImage(file) : await imageToPayload(file);
  } catch (err) {
    console.warn("Drawing preparation failed; sending the original file instead:", err);
    return {
      dataUrl: await fileToDataUrl(file),
      mimeType: file.type || "application/octet-stream",
    };
  }
}

/** Approximate decoded size of a data URL, for the payload guard. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((b64.length * 3) / 4);
}

export { MAX_PAYLOAD_BYTES };
