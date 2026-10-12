/**
 * One room overlay on the drawing viewer.
 *
 * View mode: hover/click highlights the room (unchanged behaviour).
 * Edit mode:
 *  - drag the box (or its label) to move it
 *  - drag any of the 8 handles to resize it
 *  - double-click, press Enter/F2, or use the pencil to rename it
 *  - keyboard: arrows move, Shift+arrows resize, Esc deselects
 *
 * All geometry is kept on the stored 0-1000 sheet scale, so edits stay
 * correct at any zoom level.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Lasso } from "lucide-react";
import type { BBox, Room } from "@/lib/types";
import {
  adjustBox,
  boxesEqual,
  cleanRoomName,
  HANDLE_CURSOR,
  pixelsToSheet,
  RESIZE_HANDLES,
  roundBox,
  type BoxHandle,
} from "@/lib/bboxEdit";

interface Props {
  room: Room;
  box: BBox;
  /** Base colour as `hsl(H S% L%)`. */
  color: string;
  zoom: number;
  isHot: boolean;
  isSelected: boolean;
  isFreeformTarget?: boolean;
  editMode: boolean;
  showLabel: boolean;
  /** On-screen rect of the overlay layer, used to convert pixels to sheet units. */
  getLayerRect: () => DOMRect | null;
  onHover: (id: string | null) => void;
  onClickRoom: (id: string) => void;
  onSelect: (id: string | null) => void;
  onCommitBox: (id: string, box: BBox, previousBox?: BBox) => void;
  onRename: (id: string, name: string) => void;
  onStartFreeform?: (id: string) => void;
}

/** Sheet units moved per arrow-key press (0.2 % of the sheet). */
const NUDGE_STEP = 2;
/** Arrow-key nudges are batched into one save after the keys go quiet. */
const NUDGE_SAVE_DELAY_MS = 500;
/** Pointer travel (screen px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

const NUDGE_KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Handle anchor as [x, y] fractions of the box. */
const HANDLE_POS: Record<Exclude<BoxHandle, "move">, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** `hsl(H S% L%)` -> `hsl(H S% L% / a)`. */
function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)\s*$/, ` / ${alpha})`);
}

interface DragState {
  handle: BoxHandle;
  startX: number;
  startY: number;
  start: BBox;
  width: number;
  height: number;
  moved: boolean;
}

export default function RoomOverlayBox({
  room,
  box,
  color,
  zoom,
  isHot,
  isSelected,
  isFreeformTarget,
  editMode,
  showLabel,
  getLayerRect,
  onHover,
  onClickRoom,
  onSelect,
  onCommitBox,
  onRename,
  onStartFreeform,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Local, unsaved geometry while dragging/nudging. Cleared once the cache catches up.
  const [draft, setDraftState] = useState<BBox | null>(null);
  const draftRef = useRef<BBox | null>(null);
  const setDraft = useCallback((next: BBox | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const nudgeTimer = useRef<number | null>(null);
  const nudgeStart = useRef<BBox | null>(null);

  const [renaming, setRenaming] = useState(false);
  const renamingRef = useRef(false);
  const [nameDraft, setNameDraft] = useState(room.name);

  const boxKey = box.join(",");

  // The saved (or rolled-back) box has arrived: stop showing the local draft.
  useEffect(() => {
    if (!drag.current && nudgeTimer.current === null) setDraft(null);
  }, [boxKey, setDraft]);

  /** Saves a finished edit unless it rounds back to where it started. */
  const commit = useCallback(
    (next: BBox, start: BBox) => {
      const rounded = roundBox(next);
      if (boxesEqual(rounded, start)) {
        setDraft(null);
        return;
      }
      setDraft(rounded);
      onCommitBox(room.id, rounded, start);
    },
    [onCommitBox, room.id, setDraft]
  );

  const flushNudge = useCallback(() => {
    if (nudgeTimer.current === null) return;
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = null;
    const start = nudgeStart.current;
    nudgeStart.current = null;
    const next = draftRef.current;
    if (start && next) commit(next, start);
  }, [commit]);

  // Never lose a pending keyboard nudge if the overlay unmounts (floor switch etc.).
  const flushRef = useRef(flushNudge);
  useEffect(() => {
    flushRef.current = flushNudge;
  }, [flushNudge]);
  useEffect(() => () => flushRef.current(), []);

  // Leaving edit mode saves any pending nudge.
  useEffect(() => {
    if (!editMode) flushNudge();
  }, [editMode, flushNudge]);

  // Window-level listeners for the active drag, so it keeps tracking off the box.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const px = e.clientX - d.startX;
      const py = e.clientY - d.startY;
      if (!d.moved && Math.hypot(px, py) < DRAG_THRESHOLD_PX) return;
      d.moved = true;
      const { dx, dy } = pixelsToSheet(px, py, d.width, d.height);
      setDraft(adjustBox(d.start, d.handle, dx, dy));
    };

    const end = (save: boolean) => {
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      if (!d) return;
      const next = draftRef.current;
      if (save && d.moved && next) commit(next, d.start);
      else setDraft(null);
    };

    const onUp = () => end(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        end(false);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging, commit, setDraft]);

  const beginDrag = (handle: BoxHandle) => (e: React.MouseEvent) => {
    // In view mode the press falls through to the canvas so panning still works.
    if (!editMode || renamingRef.current || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(room.id);
    boxRef.current?.focus({ preventScroll: true });

    const rect = getLayerRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    flushNudge();
    drag.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: draftRef.current ?? box,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setDragging(true);
  };

  const startRename = () => {
    if (!editMode) return;
    flushNudge();
    onSelect(room.id);
    setNameDraft(room.name);
    renamingRef.current = true;
    setRenaming(true);
  };

  const finishRename = (save: boolean) => {
    // Enter and the blur that follows both land here; only act once.
    if (!renamingRef.current) return;
    renamingRef.current = false;
    setRenaming(false);
    if (save) {
      const next = cleanRoomName(nameDraft, room.name);
      if (next) onRename(room.id, next);
    }
    boxRef.current?.focus({ preventScroll: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!editMode || renamingRef.current) return;
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startRename();
      return;
    }
    if (e.key === "Escape") {
      flushNudge();
      onSelect(null);
      boxRef.current?.blur();
      return;
    }
    const dir = NUDGE_KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    onSelect(room.id);
    const base = draftRef.current ?? box;
    if (nudgeStart.current === null) nudgeStart.current = base;
    const handle: BoxHandle = e.shiftKey ? "se" : "move";
    setDraft(adjustBox(base, handle, dir[0] * NUDGE_STEP, dir[1] * NUDGE_STEP));
    if (nudgeTimer.current !== null) window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(flushNudge, NUDGE_SAVE_DELAY_MS);
  };

  const [ymin, xmin, ymax, xmax] = draft ?? box;
  const active = isHot || isSelected;
  const handleSize = 10 / zoom;
  const thin = 1.5 / zoom;
  const labelFont = Math.max(6, (9 / Math.max(zoom, 1)) * 1.1);
  const tag = room.space_tag ? ` (${room.space_tag})` : "";

  return (
    <div
      ref={boxRef}
      className="pointer-events-auto absolute transition-[background-color,box-shadow,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      style={{
        top: `${ymin / 10}%`,
        left: `${xmin / 10}%`,
        height: `${(ymax - ymin) / 10}%`,
        width: `${(xmax - xmin) / 10}%`,
        border: `${active ? 2.5 : 1.5}px ${
          isFreeformTarget ? "dashed" : editMode && !isSelected ? "dashed" : "solid"
        } ${isFreeformTarget ? "hsl(var(--primary))" : color}`,
        backgroundColor: withAlpha(isFreeformTarget ? "hsl(var(--primary))" : color, active ? 0.2 : 0.08),
        boxShadow: active ? `0 0 0 3px ${withAlpha(isFreeformTarget ? "hsl(var(--primary))" : color, 0.2)}` : "none",
        borderRadius: 3,
        cursor: editMode ? (isSelected ? HANDLE_CURSOR.move : "pointer") : "pointer",
        zIndex: isSelected ? 3 : isHot ? 2 : 1,
      }}
      tabIndex={editMode ? 0 : undefined}
      role={editMode ? "button" : undefined}
      aria-label={
        editMode
          ? `${room.name}${tag}. Enter to rename, arrow keys to move, Shift plus arrow keys to resize.`
          : undefined
      }
      title={`${room.name}${tag}`}
      onMouseDown={beginDrag("move")}
      onMouseEnter={() => onHover(room.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        if (editMode) {
          e.stopPropagation();
          return;
        }
        onClickRoom(room.id);
      }}
      onDoubleClick={(e) => {
        if (!editMode) return;
        e.stopPropagation();
        startRename();
      }}
      onKeyDown={handleKeyDown}
      onBlur={flushNudge}
    >
      {showLabel && !renaming && (
        <span
          className={`absolute left-0 top-0 -translate-y-full rounded-t px-1 font-semibold leading-tight text-white ${
            editMode && isSelected ? "flex items-center whitespace-nowrap" : "max-w-full truncate"
          }`}
          style={{ backgroundColor: color, fontSize: `${labelFont}px` }}
        >
          {room.name}
          {editMode && isSelected && (
            <>
              <button
                type="button"
                className="ml-1 inline-flex items-center justify-center rounded-sm text-white/90 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
                aria-label={`Rename ${room.name}`}
                title="Rename room"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  startRename();
                }}
              >
                <Pencil style={{ width: labelFont, height: labelFont }} aria-hidden="true" />
              </button>
              {onStartFreeform && (
                <button
                  type="button"
                  className="ml-1 inline-flex items-center justify-center rounded-sm text-white/90 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-white"
                  aria-label={`Reshape ${room.name} with freeform lasso`}
                  title="Reshape with freeform lasso"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartFreeform(room.id);
                  }}
                >
                  <Lasso style={{ width: labelFont, height: labelFont }} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </span>
      )}

      {renaming && (
        <input
          autoFocus
          value={nameDraft}
          maxLength={120}
          aria-label={`Rename ${room.name}`}
          className="absolute left-0 top-0 -translate-y-full rounded-t bg-white px-1 font-semibold text-foreground shadow-card outline-none"
          style={{
            fontSize: `${12 / zoom}px`,
            width: `${Math.max(nameDraft.length + 3, 14)}ch`,
            border: `${thin}px solid ${color}`,
            zIndex: 5,
          }}
          onChange={(e) => setNameDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              finishRename(true);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finishRename(false);
            }
          }}
          onBlur={() => finishRename(true)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      )}

      {editMode &&
        isSelected &&
        !renaming &&
        RESIZE_HANDLES.map((handle) => {
          const [fx, fy] = HANDLE_POS[handle];
          return (
            <span
              key={handle}
              aria-hidden="true"
              className="absolute rounded-sm bg-white"
              style={{
                left: `${fx * 100}%`,
                top: `${fy * 100}%`,
                width: handleSize,
                height: handleSize,
                transform: "translate(-50%, -50%)",
                border: `${thin}px solid ${color}`,
                cursor: HANDLE_CURSOR[handle],
                zIndex: 4,
              }}
              onMouseDown={beginDrag(handle)}
            />
          );
        })}
    </div>
  );
}
