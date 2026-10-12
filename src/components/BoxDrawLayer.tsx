/**
 * Transparent layer over the drawing that lets the user drag out a new room box.
 * Sits above existing boxes while active so a new box can overlap them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BBox } from "@/lib/types";
import { BBOX_SCALE, boxFromPoints, isDrawableBox, roundBox } from "@/lib/bboxEdit";

interface Props {
  zoom: number;
  /** On-screen rect of the overlay layer, used to convert pixels to sheet units. */
  getLayerRect: () => DOMRect | null;
  onDrawn: (box: BBox) => void;
}

export default function BoxDrawLayer({ zoom, getLayerRect, onDrawn }: Props) {
  const [draft, setDraftState] = useState<BBox | null>(null);
  const draftRef = useRef<BBox | null>(null);
  const start = useRef<{ x: number; y: number; rect: DOMRect } | null>(null);
  const [active, setActive] = useState(false);

  const setDraft = useCallback((next: BBox | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const toSheet = (clientX: number, clientY: number, rect: DOMRect) => ({
    x: ((clientX - rect.left) / rect.width) * BBOX_SCALE,
    y: ((clientY - rect.top) / rect.height) * BBOX_SCALE,
  });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Keep the canvas from panning while drawing.
    e.stopPropagation();
    e.preventDefault();
    const rect = getLayerRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const p = toSheet(e.clientX, e.clientY, rect);
    start.current = { ...p, rect };
    setDraft(boxFromPoints(p.x, p.y, p.x, p.y));
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;

    const onMove = (e: MouseEvent) => {
      const s = start.current;
      if (!s) return;
      const p = toSheet(e.clientX, e.clientY, s.rect);
      setDraft(boxFromPoints(s.x, s.y, p.x, p.y));
    };

    const end = (save: boolean) => {
      const drawn = draftRef.current;
      start.current = null;
      setActive(false);
      setDraft(null);
      if (!save || !drawn) return;
      const rounded = roundBox(drawn);
      if (isDrawableBox(rounded)) onDrawn(rounded);
    };

    const onUp = () => end(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only cancels the box in progress; the viewer handles leaving draw mode.
        e.stopImmediatePropagation();
        end(false);
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
  }, [active, onDrawn, setDraft]);

  return (
    <div
      className="pointer-events-auto absolute inset-0 cursor-crosshair"
      style={{ zIndex: 10 }}
      onMouseDown={handleMouseDown}
      data-testid="box-draw-layer"
    >
      {draft && (
        <div
          className="absolute"
          aria-hidden="true"
          style={{
            top: `${draft[0] / 10}%`,
            left: `${draft[1] / 10}%`,
            height: `${(draft[2] - draft[0]) / 10}%`,
            width: `${(draft[3] - draft[1]) / 10}%`,
            border: `${2 / zoom}px dashed hsl(var(--primary))`,
            backgroundColor: "hsl(var(--primary) / 0.12)",
            borderRadius: 3,
          }}
        />
      )}
    </div>
  );
}
