import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
// Bundle the worker locally (Vite ?url import) — no CDN / external dependency.
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

export interface RenderedPageSize {
  /** CSS pixel width/height of the rendered page (before the viewer's zoom). */
  width: number;
  height: number;
  page: number;
  pageCount: number;
}

interface Props {
  url: string;
  /** Base render width in CSS px. The viewer's zoom transform scales this further. */
  renderWidth?: number;
  /** Which page to show (1-based). Controlled by the parent so it can gate overlays. */
  page: number;
  /** Fires after each successful render so the parent can size bbox overlays. */
  onRendered?: (size: RenderedPageSize) => void;
}

/**
 * Renders a single PDF page to a <canvas>. The parent wraps this in its own
 * zoom/pan transform and lays bbox overlays over it, so this component only
 * owns rasterisation + page navigation.
 */
export default function PdfCanvas({ url, renderWidth = 1100, page, onRendered }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<ReturnType<pdfjsLib.PDFPageProxy["render"]> | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the document once per URL.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const task = pdfjsLib.getDocument({ url });
    task.promise.then(
      (doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setPageCount(doc.numPages);
      },
      (err) => {
        if (!cancelled) {
          console.error("PDF load error:", err);
          setError("This PDF could not be rendered. Use Full screen to open it.");
          setLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url]);

  // Render the requested page whenever it (or the doc / width) changes.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || pageCount === 0) return;

    let cancelled = false;
    const safePage = Math.min(Math.max(page, 1), pageCount);

    (async () => {
      try {
        setLoading(true);
        const pdfPage = await doc.getPage(safePage);
        if (cancelled) return;

        const unscaled = pdfPage.getViewport({ scale: 1 });
        const scale = renderWidth / unscaled.width;
        // Cap the device pixel ratio so very large sheets don't blow up memory.
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = pdfPage.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTaskRef.current?.cancel();
        const task = pdfPage.render({
          canvasContext: ctx,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        await task.promise;
        if (cancelled) return;

        onRendered?.({
          width: Math.floor(viewport.width),
          height: Math.floor(viewport.height),
          page: safePage,
          pageCount,
        });
        setLoading(false);
      } catch (err) {
        // A cancelled render throws; ignore that specific case.
        if (!cancelled && (err as { name?: string })?.name !== "RenderingCancelledException") {
          console.error("PDF render error:", err);
          setError("This page could not be rendered.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, pageCount, renderWidth, onRendered]);

  if (error) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      <canvas ref={canvasRef} className="block bg-white shadow-card" />
    </div>
  );
}
