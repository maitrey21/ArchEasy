import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, Ruler, StickyNote, Pencil } from "lucide-react";
import {
  ROOM_FIELD_GROUPS,
  fieldValue,
  groupHasData,
  roomTypeLabel,
  EMPTY_VALUE,
} from "@/lib/roomFields";
import type { Room } from "@/lib/types";
import RoomEditDialog from "@/components/RoomEditDialog";

interface Props {
  room: Room | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

/**
 * Read-only, human-friendly view of every SOF field for a single room.
 * Same data as the Excel table, grouped into Flooring / Skirting / Ceiling /
 * Walls with a clear hierarchy instead of one wide row.
 */
export default function RoomDetailDialog({ room, open, onOpenChange, projectId }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  if (!room) return null;

  const area = room.area ? `${room.area} ${room.area_unit ?? "sq ft"}` : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-6">
            <DialogTitle className="text-lg flex-1">{room.name}</DialogTitle>
            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">
              {roomTypeLabel(room.room_type)}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs"
              onClick={() => { onOpenChange(false); setEditOpen(true); }}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {room.floor_level && (
              <span className="flex items-center gap-1">
                <Layers className="h-3 w-3" />
                {room.floor_level}
              </span>
            )}
            {room.space_tag && (
              <span>
                Tag: <span className="font-medium text-foreground">{room.space_tag}</span>
              </span>
            )}
            {area && (
              <span className="flex items-center gap-1">
                <Ruler className="h-3 w-3" />
                {area}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {ROOM_FIELD_GROUPS.map((group) => {
            const hasData = groupHasData(room, group);
            return (
              <section key={group.title} className="rounded-lg border border-border bg-card">
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <h3 className={`text-xs font-bold uppercase tracking-wide ${group.accent}`}>
                    {group.title}
                  </h3>
                  {!hasData && (
                    <span className="text-[10px] text-muted-foreground">not specified</span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 sm:grid-cols-3">
                  {group.fields.map((field) => {
                    const value = fieldValue(room, field.key);
                    return (
                      <div key={String(field.key)} className="min-w-0">
                        <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {field.label}
                        </dt>
                        <dd
                          className={`truncate text-sm ${
                            value === EMPTY_VALUE ? "text-muted-foreground/50" : "text-foreground"
                          }`}
                          title={value}
                        >
                          {value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            );
          })}

          {/* Remark + notes */}
          {(room.remark || room.notes) && (
            <section className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Remark
                </h3>
              </div>
              {room.remark && (
                <p className="text-sm leading-relaxed text-foreground/90">{room.remark}</p>
              )}
              {room.notes && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{room.notes}</p>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <RoomEditDialog
      room={room}
      open={editOpen}
      onOpenChange={setEditOpen}
      projectId={projectId}
    />
    </>
  );
}
