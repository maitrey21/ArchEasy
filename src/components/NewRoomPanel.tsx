/**
 * Shown after the user draws a new box: name it and pick a type to add it as a
 * room, or attach the box to an existing room that has no box yet.
 *
 * Rendered inside the zoomed overlay so it follows pan/zoom, and counter-scaled
 * so it always reads at normal size.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, MapPin, Plus, RefreshCw, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BBox, Room } from "@/lib/types";
import { cleanRoomName } from "@/lib/bboxEdit";
import { ROOM_TYPES, roomTypeLabel } from "@/lib/roomFields";

interface Props {
  box: BBox;
  zoom: number;
  /** Labels the analysis read but could not place on this drawing. */
  suggestions: string[];
  /** Rooms of this drawing that have no box yet. */
  unplacedRooms: Room[];
  /** Existing rooms on this drawing that already have a box. */
  placedRooms?: Room[];
  saving: boolean;
  onCreate: (input: { name: string; roomType: string }) => void;
  onAssign: (roomId: string) => void;
  onCancel: () => void;
}

/** Anchor the panel below the box unless it would run off the bottom of the sheet. */
const FLIP_THRESHOLD = 640;

export default function NewRoomPanel({
  box,
  zoom,
  suggestions,
  unplacedRooms,
  placedRooms,
  saving,
  onCreate,
  onAssign,
  onCancel,
}: Props) {
  const ids = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [roomType, setRoomType] = useState<string>("general");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const [ymin, xmin, ymax, xmax] = box;
  const below = ymax <= FLIP_THRESHOLD;
  const alignRight = xmin > FLIP_THRESHOLD;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const clean = cleanRoomName(name, "");
    if (!clean) {
      setError("Enter a name for this space.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onCreate({ name: clean, roomType });
  };

  const pickSuggestion = (label: string) => {
    setName(label);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <>
      {/* The box being added */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: `${ymin / 10}%`,
          left: `${xmin / 10}%`,
          height: `${(ymax - ymin) / 10}%`,
          width: `${(xmax - xmin) / 10}%`,
          border: `${2 / zoom}px dashed hsl(var(--primary))`,
          backgroundColor: "hsl(var(--primary) / 0.14)",
          borderRadius: 3,
          zIndex: 11,
        }}
      />

      <div
        role="dialog"
        aria-labelledby={`${ids}-title`}
        className="pointer-events-auto absolute"
        style={{
          top: `${(below ? ymax : ymin) / 10}%`,
          left: `${(alignRight ? xmax : xmin) / 10}%`,
          transform: `scale(${1 / zoom}) translate(${alignRight ? "-100%" : "0"}, ${
            below ? "6px" : "calc(-100% - 6px)"
          })`,
          transformOrigin: "top left",
          zIndex: 12,
        }}
        // Keep presses inside the panel from panning the canvas or starting a drag.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      >
        <form
          onSubmit={submit}
          className="w-72 rounded-lg border border-border bg-card p-3 text-left shadow-elevated"
        >
          <div className="mb-2 flex items-center justify-between">
            <h4 id={`${ids}-title`} className="text-sm font-semibold font-heading text-foreground">
              Add a room
            </h4>
            <button
              type="button"
              onClick={onCancel}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Cancel adding room"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <label htmlFor={`${ids}-name`} className="text-[11px] font-medium text-muted-foreground">
            Space name
          </label>
          <input
            ref={inputRef}
            id={`${ids}-name`}
            value={name}
            maxLength={120}
            placeholder="e.g. Electrical Room 2"
            aria-invalid={!!error}
            aria-describedby={error ? `${ids}-error` : undefined}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error && (
            <p id={`${ids}-error`} className="mt-1 text-[11px] text-destructive">
              {error}
            </p>
          )}

          <label
            htmlFor={`${ids}-type`}
            className="mt-2.5 block text-[11px] font-medium text-muted-foreground"
          >
            Room type
          </label>
          <select
            id={`${ids}-type`}
            value={roomType}
            onChange={(e) => setRoomType(e.target.value)}
            className="mt-1 h-8 w-full rounded-md border border-input bg-background px-1.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {roomTypeLabel(t)}
              </option>
            ))}
          </select>

          {suggestions.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-warning">
                <SearchX className="h-3 w-3" aria-hidden="true" />
                Not detected by AI — pick to use the name
              </p>
              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                {suggestions.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => pickSuggestion(label)}
                    aria-pressed={name === label}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                      name === label
                        ? "bg-warning text-white"
                        : "bg-warning/10 text-foreground hover:bg-warning/20"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {unplacedRooms.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-primary">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                Or place an existing room without a box
              </p>
              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                {unplacedRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    disabled={saving}
                    onClick={() => onAssign(room.id)}
                    className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                  >
                    {room.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {placedRooms && placedRooms.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-foreground">
                <RefreshCw className="h-3 w-3 text-primary" aria-hidden="true" />
                Or update boundaries of an existing room
              </p>
              <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                {placedRooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    disabled={saving}
                    onClick={() => onAssign(room.id)}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-primary/20 hover:text-primary disabled:opacity-50"
                  >
                    {room.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex justify-end gap-1.5">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-7 gap-1 text-xs" disabled={saving}>
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-3 w-3" aria-hidden="true" />
              )}
              {saving ? "Adding…" : "Add room"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
