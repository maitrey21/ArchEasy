import { useState } from "react";
import { motion } from "framer-motion";
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  LayoutList,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Floor } from "@/lib/types";

interface FloorCounts {
  rooms: number;
  drawings: number;
}

interface Props {
  floors: Floor[];
  activeFloorId: string | null;
  countsByFloor: Record<string, FloorCounts>;
  isLoading: boolean;
  /** True when the combined project-wide SOF view is showing. */
  projectViewActive: boolean;
  onSelectFloor: (id: string) => void;
  onShowProjectView: () => void;
  onAddFloor: () => void;
  onRenameFloor: (id: string, name: string) => void;
  onDeleteFloor: (id: string) => void;
  isAddingFloor?: boolean;
}

export default function FloorSidebar({
  floors,
  activeFloorId,
  countsByFloor,
  isLoading,
  projectViewActive,
  onSelectFloor,
  onShowProjectView,
  onAddFloor,
  onRenameFloor,
  onDeleteFloor,
  isAddingFloor,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Floor | null>(null);

  const startRename = (floor: Floor) => {
    setEditingId(floor.id);
    setDraftName(floor.name);
  };

  const commitRename = () => {
    if (editingId && draftName.trim()) {
      onRenameFloor(editingId, draftName);
    }
    setEditingId(null);
    setDraftName("");
  };

  const totalRooms = Object.values(countsByFloor).reduce((sum, c) => sum + c.rooms, 0);

  return (
    <aside className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blueprint-light">
          <Layers className="h-4 w-4 text-primary" />
        </div>
        <h2 className="text-sm font-semibold font-heading text-foreground">Floors</h2>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {floors.length}
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto p-2" aria-label="Floor navigation">
        {/* Combined project view */}
        <button
          onClick={onShowProjectView}
          aria-current={projectViewActive ? "true" : undefined}
          className={`mb-2 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
            projectViewActive
              ? "bg-primary/10 text-primary ring-1 ring-primary/20"
              : "text-foreground hover:bg-muted"
          }`}
        >
          <Building2 className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">Whole Project</p>
            <p className="text-[11px] text-muted-foreground">
              {totalRooms} room{totalRooms === 1 ? "" : "s"} across all floors
            </p>
          </div>
        </button>

        <div className="my-2 h-px bg-border" />

        {isLoading ? (
          <div className="space-y-2 p-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : floors.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No floors yet. Add one to start.
          </p>
        ) : (
          <ul className="space-y-1">
            {floors.map((floor) => {
              const counts = countsByFloor[floor.id] ?? { rooms: 0, drawings: 0 };
              const isActive = !projectViewActive && floor.id === activeFloorId;
              const isEditing = editingId === floor.id;

              return (
                <li key={floor.id}>
                  {isEditing ? (
                    <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1.5">
                      <Input
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        aria-label="Floor name"
                        className="h-7 text-xs"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-primary"
                        onClick={commitRename}
                        aria-label="Save floor name"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel rename"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={`group relative flex items-center rounded-lg transition-colors ${
                        isActive
                          ? "bg-primary/10 ring-1 ring-primary/20"
                          : "hover:bg-muted"
                      }`}
                    >
                      <button
                        onClick={() => onSelectFloor(floor.id)}
                        aria-current={isActive ? "true" : undefined}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
                      >
                        <LayoutList
                          className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm font-medium ${
                              isActive ? "text-primary" : "text-foreground"
                            }`}
                          >
                            {floor.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {counts.drawings} drawing{counts.drawings === 1 ? "" : "s"} ·{" "}
                            {counts.rooms} room{counts.rooms === 1 ? "" : "s"}
                          </p>
                        </div>
                      </button>

                      <div className="flex shrink-0 items-center gap-0.5 pr-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => startRename(floor)}
                              aria-label={`Rename ${floor.name}`}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="right">Rename</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingDelete(floor)}
                              aria-label={`Delete ${floor.name}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="right">Delete floor</TooltipContent>
                        </Tooltip>
                      </div>

                      {isActive && (
                        <motion.div
                          layoutId="active-floor-bar"
                          className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-primary"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="border-t border-border p-3">
        <Button
          onClick={onAddFloor}
          disabled={isAddingFloor}
          variant="outline"
          className="w-full gap-2"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          {isAddingFloor ? "Adding..." : "Add Floor"}
        </Button>
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes this floor along with its{" "}
              {countsByFloor[pendingDelete?.id ?? ""]?.drawings ?? 0} drawing(s),{" "}
              {countsByFloor[pendingDelete?.id ?? ""]?.rooms ?? 0} room(s) and their finishes.
              Other floors are not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDelete) onDeleteFloor(pendingDelete.id);
                setPendingDelete(null);
              }}
            >
              Delete floor
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
