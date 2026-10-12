import { useEffect, useId } from "react";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BBox } from "@/lib/types";

interface Props {
  roomName: string;
  box: BBox;
  zoom: number;
  onSave: () => void;
  onUndo: () => void;
}

const FLIP_THRESHOLD = 640;

export default function ShapeEditPrompt({
  roomName,
  box,
  zoom,
  onSave,
  onUndo,
}: Props) {
  const ids = useId();
  const [ymin, xmin, ymax, xmax] = box;
  const below = ymax <= FLIP_THRESHOLD;
  const alignRight = xmin > FLIP_THRESHOLD;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onUndo();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onSave, onUndo]);

  return (
    <div
      role="dialog"
      aria-labelledby={`${ids}-title`}
      className="pointer-events-auto absolute"
      style={{
        top: `${(below ? ymax : ymin) / 10}%`,
        left: `${(alignRight ? xmax : xmin) / 10}%`,
        transform: `scale(${1 / zoom}) translate(${alignRight ? "-100%" : "0"}, ${
          below ? "8px" : "calc(-100% - 8px)"
        })`,
        transformOrigin: "top left",
        zIndex: 25,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="w-80 rounded-lg border border-border bg-card p-3.5 shadow-elevated">
        <div className="flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h4
              id={`${ids}-title`}
              className="text-sm font-semibold font-heading text-foreground"
            >
              Save shape changes?
            </h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Review new boundaries for{" "}
              <strong className="text-foreground">{roomName}</strong>.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/60 pt-2.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs hover:bg-muted text-muted-foreground hover:text-foreground"
            onClick={onUndo}
            title="Discard changes and revert (Esc)"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Undo (Esc)
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm"
            onClick={onSave}
            title="Save changes to drawing (Enter)"
          >
            <Check className="h-3.5 w-3.5" />
            Save changes (Enter)
          </Button>
        </div>
      </div>
    </div>
  );
}
