import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import RoomEditDialog from "@/components/RoomEditDialog";
import type { Room } from "@/lib/types";

interface Props {
  rooms: Room[];
  projectId: string;
  /** Optional two-way highlight sync with the drawing viewer. */
  highlightedRoomId?: string | null;
  onHighlightRoom?: (id: string | null) => void;
  /** Shown as a grouping banner in the combined project view. */
  groupLabel?: string;
}

const columnGroups = [
  {
    label: "",
    columns: [
      { key: "floor_level", label: "Floor" },
      { key: "name", label: "Space Description" },
      { key: "space_tag", label: "Space/Room Tag" },
    ],
  },
  {
    label: "FLOORING",
    columns: [
      { key: "floor_finish", label: "Material" },
      { key: "flooring_size", label: "Size" },
      { key: "flooring_finish", label: "Finish" },
      { key: "flooring_code", label: "Code No" },
      { key: "flooring_make", label: "Make" },
      { key: "flooring_rate", label: "Basic Rate" },
    ],
  },
  {
    label: "SKIRTING",
    columns: [
      { key: "skirting", label: "Material" },
      { key: "skirting_code", label: "Code No" },
      { key: "skirting_make", label: "Make" },
      { key: "skirting_rate", label: "Basic Rate" },
    ],
  },
  {
    label: "CEILING",
    columns: [
      { key: "ceiling_finish", label: "Material 1" },
      { key: "ceiling_material_2", label: "Material 2" },
      { key: "ceiling_size", label: "Size" },
      { key: "ceiling_code", label: "Code No" },
      { key: "ceiling_make", label: "Make" },
      { key: "ceiling_rate", label: "Basic Rate" },
    ],
  },
  {
    label: "",
    columns: [{ key: "remark", label: "Remark" }],
  },
];

const allColumns = columnGroups.flatMap((g) => g.columns);

export default function RoomTable({
  rooms,
  projectId,
  highlightedRoomId,
  onHighlightRoom,
  groupLabel,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const deleteRoom = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rooms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms", projectId] });
      toast({ title: "Room deleted" });
    },
  });

  const openEdit = (room: Room) => {
    setEditRoom(room);
    setEditOpen(true);
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {groupLabel && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
          <h3 className="text-sm font-semibold font-heading text-foreground">{groupLabel}</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {rooms.length} room{rooms.length === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {/* Group header row */}
            <TableRow className="bg-primary/10 border-b-2 border-primary/20">
              <TableHead className="text-center text-[10px] font-bold uppercase tracking-wider text-primary w-10">
                Sr.No
              </TableHead>
              {columnGroups.map((group, i) => (
                <TableHead
                  key={i}
                  colSpan={group.columns.length}
                  className="text-center text-[10px] font-bold uppercase tracking-wider text-primary border-l border-border/50"
                >
                  {group.label}
                </TableHead>
              ))}
              <TableHead className="w-20 border-l border-border/50" />
            </TableRow>
            {/* Sub-header row */}
            <TableRow className="bg-muted/50">
              <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-10">
                #
              </TableHead>
              {allColumns.map((col) => (
                <TableHead
                  key={col.key}
                  className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap border-l border-border/30 min-w-[100px]"
                >
                  {col.label}
                </TableHead>
              ))}
              <TableHead className="w-20 border-l border-border/30" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room, idx) => (
              <TableRow
                key={room.id}
                onMouseEnter={() => onHighlightRoom?.(room.id)}
                onMouseLeave={() => onHighlightRoom?.(null)}
                className={
                  highlightedRoomId === room.id
                    ? "bg-primary/10 ring-1 ring-inset ring-primary/20"
                    : "hover:bg-muted/30"
                }
              >
                <TableCell className="text-xs text-muted-foreground font-medium">
                  {idx + 1}
                </TableCell>
                {allColumns.map((col) => (
                  <TableCell key={col.key} className="text-xs border-l border-border/20">
                    <span className="text-foreground">
                      {String(room[col.key as keyof Room] ?? "") || "—"}
                    </span>
                  </TableCell>
                ))}
                <TableCell className="border-l border-border/20">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(room)} className="h-6 w-6" title="Edit room">
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm("Delete this room? This cannot be undone.")) {
                          deleteRoom.mutate(room.id);
                        }
                      }}
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      title="Delete room"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <RoomEditDialog
        room={editRoom}
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
      />
    </div>
  );
}
