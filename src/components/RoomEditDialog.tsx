import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Save,
  X,
  Grid2x2,
  Layers,
  PaintBucket,
  Wallpaper,
  StickyNote,
  AlignLeft,
} from "lucide-react";
import { roomTypeLabel } from "@/lib/roomFields";
import type { Room } from "@/lib/types";

interface Props {
  room: Room | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

type EditableRoom = Pick<
  Room,
  | "name"
  | "floor_level"
  | "space_tag"
  | "floor_finish"
  | "flooring_size"
  | "flooring_finish"
  | "flooring_code"
  | "flooring_make"
  | "flooring_rate"
  | "skirting"
  | "skirting_code"
  | "skirting_make"
  | "skirting_rate"
  | "ceiling_finish"
  | "ceiling_material_2"
  | "ceiling_size"
  | "ceiling_code"
  | "ceiling_make"
  | "ceiling_rate"
  | "wall_finish"
  | "paint_color"
  | "dado"
  | "remark"
  | "notes"
>;

function toEditable(room: Room): EditableRoom {
  return {
    name: room.name ?? "",
    floor_level: room.floor_level ?? "",
    space_tag: room.space_tag ?? "",
    floor_finish: room.floor_finish ?? "",
    flooring_size: room.flooring_size ?? "",
    flooring_finish: room.flooring_finish ?? "",
    flooring_code: room.flooring_code ?? "",
    flooring_make: room.flooring_make ?? "",
    flooring_rate: room.flooring_rate ?? "",
    skirting: room.skirting ?? "",
    skirting_code: room.skirting_code ?? "",
    skirting_make: room.skirting_make ?? "",
    skirting_rate: room.skirting_rate ?? "",
    ceiling_finish: room.ceiling_finish ?? "",
    ceiling_material_2: room.ceiling_material_2 ?? "",
    ceiling_size: room.ceiling_size ?? "",
    ceiling_code: room.ceiling_code ?? "",
    ceiling_make: room.ceiling_make ?? "",
    ceiling_rate: room.ceiling_rate ?? "",
    wall_finish: room.wall_finish ?? "",
    paint_color: room.paint_color ?? "",
    dado: room.dado ?? "",
    remark: room.remark ?? "",
    notes: room.notes ?? "",
  };
}

interface FieldInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}

function FieldInput({ id, label, value, onChange, placeholder, multiline }: FieldInputProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? label}
          className="min-h-[70px] resize-none text-sm"
        />
      ) : (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? label}
          className="h-8 text-sm"
        />
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  accentClass: string;
  children: React.ReactNode;
}

function Section({ title, icon, accentClass, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className={`flex items-center gap-2 border-b border-border/60 px-4 py-2.5 ${accentClass}`}>
        {icon}
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export default function RoomEditDialog({ room, open, onOpenChange, projectId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditableRoom>(room ? toEditable(room) : {} as EditableRoom);

  // Sync form when room changes
  useEffect(() => {
    if (room) setForm(toEditable(room));
  }, [room]);

  const set = (key: keyof EditableRoom) => (val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  const updateRoom = useMutation({
    mutationFn: async () => {
      if (!room) return;
      // Convert empty strings back to null for optional fields
      const payload: Partial<Room> = {};
      (Object.keys(form) as (keyof EditableRoom)[]).forEach((k) => {
        const v = form[k];
        (payload as Record<string, unknown>)[k] = v === "" ? null : v;
      });
      const { error } = await supabase.from("rooms").update(payload).eq("id", room.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rooms", projectId] });
      toast({ title: "Room updated", description: "Changes saved successfully." });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  if (!room) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-0">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur-sm px-6 py-4">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2 pr-4">
              <DialogTitle className="text-base font-semibold">{room.name}</DialogTitle>
              <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-[10px]">
                {roomTypeLabel(room.room_type)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Edit all finish details below. Changes are saved to the schedule.
            </p>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-4">
          {/* Basic info */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-muted-foreground">
              <AlignLeft className="h-3.5 w-3.5" />
              <h3 className="text-xs font-bold uppercase tracking-wide">Basic Info</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
              <FieldInput id="name" label="Space Description" value={form.name as string} onChange={set("name")} />
              <FieldInput id="floor_level" label="Floor Level" value={form.floor_level as string} onChange={set("floor_level")} />
              <FieldInput id="space_tag" label="Space / Room Tag" value={form.space_tag as string} onChange={set("space_tag")} />
            </div>
          </div>

          {/* Flooring */}
          <Section
            title="Flooring"
            icon={<Grid2x2 className="h-3.5 w-3.5" />}
            accentClass="bg-primary/5 text-primary"
          >
            <div className="col-span-2 sm:col-span-3">
              <FieldInput id="floor_finish" label="Material" value={form.floor_finish as string} onChange={set("floor_finish")} placeholder="e.g. Commercial Modular Carpet Tiles" />
            </div>
            <FieldInput id="flooring_size" label="Size" value={form.flooring_size as string} onChange={set("flooring_size")} placeholder="e.g. 600×600 mm" />
            <FieldInput id="flooring_finish" label="Finish" value={form.flooring_finish as string} onChange={set("flooring_finish")} placeholder="e.g. Tufted Loop Pile Heavy Commercial" />
            <FieldInput id="flooring_code" label="Code No" value={form.flooring_code as string} onChange={set("flooring_code")} placeholder="e.g. FL-CPT-05" />
            <FieldInput id="flooring_make" label="Make" value={form.flooring_make as string} onChange={set("flooring_make")} placeholder="e.g. Interface / Shaw" />
            <FieldInput id="flooring_rate" label="Basic Rate" value={form.flooring_rate as string} onChange={set("flooring_rate")} placeholder="e.g. ₹350 / sq ft" />
          </Section>

          {/* Skirting */}
          <Section
            title="Skirting"
            icon={<Layers className="h-3.5 w-3.5" />}
            accentClass="bg-accent/5 text-accent"
          >
            <div className="col-span-2 sm:col-span-3">
              <FieldInput id="skirting" label="Material" value={form.skirting as string} onChange={set("skirting")} placeholder="e.g. Extruded Aluminium Skirting with Anodized Finish 75mm" />
            </div>
            <FieldInput id="skirting_code" label="Code No" value={form.skirting_code as string} onChange={set("skirting_code")} placeholder="e.g. SK-AL-02" />
            <FieldInput id="skirting_make" label="Make" value={form.skirting_make as string} onChange={set("skirting_make")} placeholder="e.g. Custom Fabricated" />
            <FieldInput id="skirting_rate" label="Basic Rate" value={form.skirting_rate as string} onChange={set("skirting_rate")} placeholder="e.g. ₹120 / rft" />
          </Section>

          {/* Ceiling */}
          <Section
            title="Ceiling"
            icon={<PaintBucket className="h-3.5 w-3.5" />}
            accentClass="bg-warning/5 text-warning"
          >
            <div className="col-span-2 sm:col-span-3">
              <FieldInput id="ceiling_finish" label="Material 1" value={form.ceiling_finish as string} onChange={set("ceiling_finish")} placeholder="e.g. Mineral Fibre Acoustic Lay-in Ceiling" />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <FieldInput id="ceiling_material_2" label="Material 2" value={form.ceiling_material_2 as string} onChange={set("ceiling_material_2")} placeholder="e.g. Exposed Ducting Feature with Black Acoustic Spray" />
            </div>
            <FieldInput id="ceiling_size" label="Size" value={form.ceiling_size as string} onChange={set("ceiling_size")} placeholder="e.g. 600×600 mm" />
            <FieldInput id="ceiling_code" label="Code No" value={form.ceiling_code as string} onChange={set("ceiling_code")} placeholder="e.g. CL-AC-05" />
            <FieldInput id="ceiling_make" label="Make" value={form.ceiling_make as string} onChange={set("ceiling_make")} placeholder="e.g. Armstrong Fine Fissured" />
            <FieldInput id="ceiling_rate" label="Basic Rate" value={form.ceiling_rate as string} onChange={set("ceiling_rate")} placeholder="e.g. ₹180 / sq ft" />
          </Section>

          {/* Walls */}
          <Section
            title="Walls"
            icon={<Wallpaper className="h-3.5 w-3.5" />}
            accentClass="bg-blue-500/5 text-blue-600"
          >
            <div className="col-span-2 sm:col-span-3">
              <FieldInput id="wall_finish" label="Wall Finish" value={form.wall_finish as string} onChange={set("wall_finish")} placeholder="e.g. Acrylic Emulsion Paint" />
            </div>
            <FieldInput id="paint_color" label="Paint / Colour" value={form.paint_color as string} onChange={set("paint_color")} placeholder="e.g. Off White" />
            <FieldInput id="dado" label="Dado" value={form.dado as string} onChange={set("dado")} placeholder="e.g. Glazed Vitrified Tiles up to 900mm" />
          </Section>

          {/* Remarks */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-muted-foreground">
              <StickyNote className="h-3.5 w-3.5" />
              <h3 className="text-xs font-bold uppercase tracking-wide">Remark &amp; Notes</h3>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
              <FieldInput id="remark" label="Remark" value={form.remark as string} onChange={set("remark")} multiline placeholder="Any specific finish remarks…" />
              <FieldInput id="notes" label="Internal Notes" value={form.notes as string} onChange={set("notes")} multiline placeholder="Internal notes (not exported)…" />
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <DialogFooter className="sticky bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur-sm px-6 py-3 flex-row gap-2 justify-end">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={updateRoom.isPending}
            className="gap-1.5"
          >
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button
            onClick={() => updateRoom.mutate()}
            disabled={updateRoom.isPending}
            className="gap-1.5"
          >
            {updateRoom.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
