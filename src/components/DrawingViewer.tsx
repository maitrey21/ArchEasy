import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Tag,
  SquareDashedMousePointer,
  FileText,
  Image as ImageIcon,
  Loader2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Expand,
  Shrink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import PdfCanvas, { type RenderedPageSize } from "@/components/PdfCanvas";
import { parseBBox, type Room, type Drawing } from "@/lib/types";

interface Props {
  drawing: Drawing | null;
  rooms: Room[];
  highlightedRoomId: string | null;
  onHighlightRoom: (id: string | null) => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;

/** Colour a room overlay by its type so finishes group visually. */
function roomTypeColor(roomType: string | null): string {
  switch (roomType) {
    case "bathroom":
      return "hsl(199 89% 48%)";
    case "kitchen":
      return "hsl(25 95% 53%)";
    case "bedroom":
      return "hsl(262 83% 58%)";
    case "living":
    case "dining":
      return "hsl(152 60% 42%)";
    case "lobby":
    case "hallway":
      return "hsl(215 80% 48%)";
    case "staircase":
      return "hsl(340 75% 55%)";
    case "utility":
    case "service":
    case "storage":
      return "hsl(215 15% 50%)";
    case "balcony":
      return "hsl(175 60% 40%)";
    case "office":
      return "hsl(240 70% 55%)";
    case "parking":
    case "garage":
      return "hsl(38 92% 50%)";
    default:
      return "hsl(215 80% 48%)";
  }
}

export default function DrawingViewer({
  drawing,
  rooms,
  highlightedRoomId,
  onHighlightRoom,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [isPanning, setIsPanning] = useState(false);

  // PDF-specific: current page + the last rendered page's size / count.
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfInfo, setPdfInfo] = useState<RenderedPageSize | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const [containerWidth, setContainerWidth] = useState(900);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const isPdf = (drawing?.file_name ?? "").toLowerCase().endsWith(".pdf");

  // Signed URL: the drawings bucket is private, so a public URL won't load.
  const { data: signedUrl, isLoading: urlLoading } = useQuery({
    queryKey: ["drawing-url", drawing?.storage_path],
    enabled: !!drawing?.storage_path,
    // Refresh comfortably before the 1 hour expiry.
    staleTime: 45 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("drawings")
        .createSignedUrl(drawing!.storage_path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const roomsWithBoxes = useMemo(
    () =>
      rooms
        .map((room) => ({ room, box: parseBBox(room.bbox) }))
        .filter((r): r is { room: Room; box: [number, number, number, number] } => r.box !== null),
    [rooms]
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Reset the view + PDF page when the drawing changes so a new floor starts clean.
  useEffect(() => {
    resetView();
    setPdfPage(1);
    setPdfInfo(null);
  }, [drawing?.id, resetView]);

  // Track the canvas container width so PDFs render fit-to-width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth || 900);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => clampZoom(z * delta));
  };

  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
  };

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      setOffset({
        x: panStart.current.offsetX + (e.clientX - panStart.current.x),
        y: panStart.current.offsetY + (e.clientY - panStart.current.y),
      });
    };
    const onUp = () => setIsPanning(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  const handleRendered = useCallback((size: RenderedPageSize) => setPdfInfo(size), []);

  // Full screen the whole viewer (toolbar + canvas + overlays) via the
  // Fullscreen API, so highlights stay on top — unlike opening the raw PDF.
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Overlays are anchored to the sheet the AI analysed. For PDFs we only trust
  // page 1 (a floor plan is virtually always a single sheet).
  const overlaysVisible =
    showAnnotations && (!isPdf || pdfPage === 1) && roomsWithBoxes.length > 0;

  const pdfPageCount = pdfInfo?.pageCount ?? 1;

  if (!drawing) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blueprint-light">
          <ImageIcon className="h-6 w-6 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">No drawing on this floor yet</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">
          Upload a floor plan and the detected rooms will appear here as overlays you can highlight.
        </p>
      </div>
    );
  }

  const overlayLayer = (
    <div className="pointer-events-none absolute inset-0">
      {roomsWithBoxes.map(({ room, box }) => {
        const [ymin, xmin, ymax, xmax] = box;
        const color = roomTypeColor(room.room_type);
        const isHot = highlightedRoomId === room.id;
        return (
          <div
            key={room.id}
            className="pointer-events-auto absolute cursor-pointer transition-all"
            style={{
              top: `${ymin / 10}%`,
              left: `${xmin / 10}%`,
              height: `${(ymax - ymin) / 10}%`,
              width: `${(xmax - xmin) / 10}%`,
              border: `${isHot ? 2.5 : 1.5}px solid ${color}`,
              backgroundColor: isHot ? `${color}33` : `${color}14`,
              boxShadow: isHot ? `0 0 0 3px ${color}33` : "none",
              borderRadius: 3,
              zIndex: isHot ? 2 : 1,
            }}
            onMouseEnter={() => onHighlightRoom(room.id)}
            onMouseLeave={() => onHighlightRoom(null)}
            onClick={() => onHighlightRoom(isHot ? null : room.id)}
            title={`${room.name}${room.space_tag ? ` (${room.space_tag})` : ""}`}
          >
            {showLabels && (
              <span
                className="absolute left-0 top-0 max-w-full -translate-y-full truncate rounded-t px-1 font-semibold leading-tight text-white"
                style={{
                  backgroundColor: color,
                  fontSize: `${Math.max(6, (9 / Math.max(zoom, 1)) * 1.1)}px`,
                }}
              >
                {room.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`flex flex-col overflow-hidden border border-border bg-card ${
        isFullscreen ? "h-screen w-screen rounded-none" : "h-full rounded-xl"
      }`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-card/80 px-3 py-2">
        <div className="mr-1 flex min-w-0 items-center gap-2">
          {isPdf ? (
            <FileText className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="truncate text-xs font-medium text-foreground" title={drawing.file_name}>
            {drawing.file_name}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Page nav (multi-page PDFs only) */}
          {isPdf && pdfPageCount > 1 && (
            <>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
                disabled={pdfPage <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="w-12 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
                {pdfPage}/{pdfPageCount}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setPdfPage((p) => Math.min(pdfPageCount, p + 1))}
                disabled={pdfPage >= pdfPageCount}
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={showAnnotations ? "default" : "outline"}
                className="h-7 w-7"
                onClick={() => setShowAnnotations((v) => !v)}
                aria-label="Toggle AI annotations"
                aria-pressed={showAnnotations}
              >
                <SquareDashedMousePointer className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showAnnotations ? "Hide" : "Show"} AI room overlays</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={showLabels ? "default" : "outline"}
                className="h-7 w-7"
                onClick={() => setShowLabels((v) => !v)}
                disabled={!showAnnotations}
                aria-label="Toggle room labels"
                aria-pressed={showLabels}
              >
                <Tag className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showLabels ? "Hide" : "Show"} room labels</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setZoom((z) => clampZoom(z / 1.25))}
                aria-label="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>

          <span className="w-11 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => setZoom((z) => clampZoom(z * 1.25))}
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={resetView}
                aria-label="Reset view"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to view</TooltipContent>
          </Tooltip>

          <div className="mx-1 h-5 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={isFullscreen ? "default" : "outline"}
                className="h-7 w-7"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? (
                  <Shrink className="h-3.5 w-3.5" />
                ) : (
                  <Expand className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? "Exit full screen" : "Full screen"}</TooltipContent>
          </Tooltip>

          {isPdf && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="outline" className="h-7 w-7">
                  <a
                    href={signedUrl ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open original PDF in a new tab"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open original PDF in a new tab</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={startPan}
        className={`blueprint-grid relative flex-1 overflow-hidden bg-muted/30 ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{ minHeight: 460 }}
      >
        {urlLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : !signedUrl ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Could not load this drawing from storage.
            </p>
          </div>
        ) : (
          <div
            className="absolute left-1/2 top-1/2 origin-center"
            style={{
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
              transition: isPanning ? "none" : "transform 120ms ease-out",
            }}
          >
            {/* Wrapper shrink-wraps the media so bbox percentages line up. */}
            <div className="relative inline-block">
              {isPdf ? (
                <PdfCanvas
                  url={signedUrl}
                  page={pdfPage}
                  renderWidth={Math.max(320, Math.min(containerWidth - 32, 1400))}
                  onRendered={handleRendered}
                />
              ) : (
                <img
                  src={signedUrl}
                  alt={`Architectural drawing: ${drawing.file_name}`}
                  className="block max-h-none max-w-none select-none"
                  style={{ maxWidth: "min(72vw, 900px)" }}
                  draggable={false}
                />
              )}

              {overlaysVisible && overlayLayer}
            </div>
          </div>
        )}

        {/* Status chip */}
        {showAnnotations && signedUrl && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-card/90 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground shadow-card backdrop-blur-sm">
            {isPdf && pdfPage !== 1 ? (
              "Highlights are shown on sheet 1"
            ) : roomsWithBoxes.length > 0 ? (
              <>
                {roomsWithBoxes.length} of {rooms.length} room
                {rooms.length === 1 ? "" : "s"} highlighted
                <span className="ml-1.5 rounded bg-primary/10 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                  AI
                </span>
              </>
            ) : (
              "No room coordinates for this drawing"
            )}
          </div>
        )}
      </div>
    </div>
  );
}
