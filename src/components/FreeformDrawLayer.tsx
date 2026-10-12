/**
 * Freeform lasso draw layer — the user draws any shape freely on the canvas.
 * On mouseup the convex hull bounding box is computed from all traced points
 * and emitted as a BBox [ymin, xmin, ymax, xmax] on the 0-1000 sheet scale.
 *
 * Supports both:
 * 1. Reshaping an existing room (when targetRoom is selected or clicked).
 * 2. Drawing a brand new room box.
 * 3. Clicking on any existing room on the canvas to select it for reshaping.
 */
import { useEffect, useRef, useState } from "react";
import type { BBox, Room } from "@/lib/types";
import { BBOX_SCALE, isDrawableBox, roundBox } from "@/lib/bboxEdit";

interface Props {
  zoom: number;
  getLayerRect: () => DOMRect | null;
  targetRoom?: Room | null;
  targetBox?: BBox | null;
  existingRooms?: { room: Room; box: BBox }[];
  onSelectRoom?: (id: string | null) => void;
  onDrawn: (box: BBox, targetRoomId?: string | null) => void;
}

interface Point {
  x: number; // sheet units (0-1000)
  y: number;
}

const SAMPLE_DIST_PX = 4; // minimum pixel travel between recorded points
const CLICK_THRESHOLD_PX = 6;

function fitBBox(pts: Point[]): BBox | null {
  if (pts.length === 0) return null;
  let xmin = Infinity,
    ymin = Infinity,
    xmax = -Infinity,
    ymax = -Infinity;
  for (const { x, y } of pts) {
    if (x < xmin) xmin = x;
    if (y < ymin) ymin = y;
    if (x > xmax) xmax = x;
    if (y > ymax) ymax = y;
  }
  return [ymin, xmin, ymax, xmax];
}

export default function FreeformDrawLayer({
  zoom,
  getLayerRect,
  targetRoom,
  targetBox,
  existingRooms,
  onSelectRoom,
  onDrawn,
}: Props) {
  const [pts, setPts] = useState<Point[]>([]);
  const ptsRef = useRef<Point[]>([]);
  const startClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastClientRef = useRef<{ x: number; y: number } | null>(null);
  const dragDistRef = useRef(0);
  const [active, setActive] = useState(false);
  const rectRef = useRef<DOMRect | null>(null);

  const toSheet = (clientX: number, clientY: number, rect: DOMRect): Point => ({
    x: Math.min(Math.max(((clientX - rect.left) / rect.width) * BBOX_SCALE, 0), BBOX_SCALE),
    y: Math.min(Math.max(((clientY - rect.top) / rect.height) * BBOX_SCALE, 0), BBOX_SCALE),
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = getLayerRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    rectRef.current = rect;
    const p = toSheet(e.clientX, e.clientY, rect);
    ptsRef.current = [p];
    startClientRef.current = { x: e.clientX, y: e.clientY };
    lastClientRef.current = { x: e.clientX, y: e.clientY };
    dragDistRef.current = 0;
    setPts([p]);
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;

    const onMove = (e: MouseEvent) => {
      const rect = rectRef.current;
      if (!rect) return;

      if (startClientRef.current) {
        const totalDist = Math.hypot(
          e.clientX - startClientRef.current.x,
          e.clientY - startClientRef.current.y
        );
        dragDistRef.current = totalDist;
      }

      const last = lastClientRef.current;
      if (last) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        if (Math.hypot(dx, dy) < SAMPLE_DIST_PX) return; // throttle
      }
      lastClientRef.current = { x: e.clientX, y: e.clientY };
      const p = toSheet(e.clientX, e.clientY, rect);
      const next = [...ptsRef.current, p];
      ptsRef.current = next;
      setPts([...next]);
    };

    const finish = (save: boolean, clientX?: number, clientY?: number) => {
      const drawn = ptsRef.current;
      const rect = rectRef.current;
      const totalDist = dragDistRef.current;

      ptsRef.current = [];
      startClientRef.current = null;
      lastClientRef.current = null;
      rectRef.current = null;
      dragDistRef.current = 0;
      setPts([]);
      setActive(false);

      if (!save) return;

      // Click detected (negligible mouse drag) -> select or deselect room under cursor
      if (totalDist < CLICK_THRESHOLD_PX || drawn.length < 2) {
        if (rect && clientX !== undefined && clientY !== undefined && existingRooms && onSelectRoom) {
          const clickPoint = toSheet(clientX, clientY, rect);
          // Find rooms containing the clicked point
          const matching = existingRooms.filter(({ box }) => {
            return (
              clickPoint.x >= box[1] &&
              clickPoint.x <= box[3] &&
              clickPoint.y >= box[0] &&
              clickPoint.y <= box[2]
            );
          });

          if (matching.length > 0) {
            // Sort by area ascending so smaller/more specific room gets selected
            matching.sort((a, b) => {
              const areaA = (a.box[3] - a.box[1]) * (a.box[2] - a.box[0]);
              const areaB = (b.box[3] - b.box[1]) * (b.box[2] - b.box[0]);
              return areaA - areaB;
            });
            onSelectRoom(matching[0].room.id);
          } else {
            // Clicked on empty space: deselect target room
            onSelectRoom(null);
          }
        }
        return;
      }

      // Valid freeform draw gesture
      const bbox = fitBBox(drawn);
      if (!bbox) return;
      const rounded = roundBox(bbox);
      if (isDrawableBox(rounded)) {
        onDrawn(rounded, targetRoom?.id ?? null);
      }
    };

    const onUp = (e: MouseEvent) => finish(true, e.clientX, e.clientY);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        finish(false);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [active, existingRooms, onDrawn, onSelectRoom, targetRoom]);

  const pathD =
    pts.length > 1
      ? `M ${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")} Z`
      : "";

  // Bounding preview rect
  const preview = pts.length > 1 ? fitBBox(pts) : null;

  return (
    <div
      className="pointer-events-auto absolute inset-0 select-none"
      style={{ cursor: "crosshair", zIndex: 10 }}
      onMouseDown={handleMouseDown}
      data-testid="freeform-draw-layer"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
      >
        {/* If target room is being reshaped, highlight its existing box */}
        {targetBox && targetRoom && (
          <g>
            <rect
              x={targetBox[1]}
              y={targetBox[0]}
              width={targetBox[3] - targetBox[1]}
              height={targetBox[2] - targetBox[0]}
              fill="hsl(var(--primary) / 0.12)"
              stroke="hsl(var(--primary))"
              strokeWidth={3 / zoom}
              strokeDasharray={`${8 / zoom} ${6 / zoom}`}
              vectorEffect="non-scaling-stroke"
              rx={2}
            />
          </g>
        )}

        {/* Live lasso path */}
        {pts.length > 1 && (
          <>
            <path
              d={pathD}
              fill="hsl(var(--primary) / 0.15)"
              stroke="hsl(var(--primary))"
              strokeWidth={8 / zoom}
              strokeDasharray={`${20 / zoom} ${10 / zoom}`}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Tight bounding-box preview */}
            {preview && (
              <rect
                x={preview[1]}
                y={preview[0]}
                width={preview[3] - preview[1]}
                height={preview[2] - preview[0]}
                fill="none"
                stroke="hsl(var(--primary) / 0.85)"
                strokeWidth={5 / zoom}
                strokeDasharray={`${14 / zoom} ${7 / zoom}`}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </>
        )}
      </svg>

      {/* Target room floating indicator */}
      {targetBox && targetRoom && pts.length <= 1 && (
        <div
          className="pointer-events-none absolute -translate-y-full rounded px-2 py-0.5 text-xs font-semibold text-primary-foreground shadow-md backdrop-blur-sm"
          style={{
            top: `${targetBox[0] / 10}%`,
            left: `${targetBox[1] / 10}%`,
            backgroundColor: "hsl(var(--primary))",
            transformOrigin: "bottom left",
            transform: `scale(${Math.max(0.65, 1 / zoom)}) translateY(-6px)`,
            zIndex: 11,
          }}
        >
          Reshaping: {targetRoom.name}
        </div>
      )}
    </div>
  );
}
