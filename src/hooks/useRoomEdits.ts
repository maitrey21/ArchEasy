/**
 * Saves edits made directly on the drawing: box size/position, room name,
 * and brand-new rooms drawn by the user.
 *
 * Box and name updates are applied optimistically to the ["rooms", projectId]
 * cache so the overlay, schedule table and room cards all change immediately,
 * then rolled back if Supabase rejects the write. New rooms are appended to the
 * same cache once the insert returns, so they appear in the room cards right
 * away. Row-level security already restricts every write to the signed-in
 * owner of the room.
 */
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, type BBox, type Drawing, type Room } from "@/lib/types";

export interface RoomEditPatch {
  bbox?: BBox;
  name?: string;
}

export interface NewRoomInput {
  drawing: Drawing;
  name: string;
  roomType: string;
  bbox: BBox;
  /** Floor name, matching how analysed rooms record floor_level. */
  floorLevel: string;
}

/** Marks rows a person drew by hand, so they can be told apart from AI detections. */
export const MANUAL_ROOM_NOTE = "Added manually on the drawing";

export function useRoomEdits(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryKey = ["rooms", projectId];

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: RoomEditPatch }) => {
      const { error } = await supabase.from("rooms").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Room[]>(queryKey);
      queryClient.setQueryData<Room[]>(queryKey, (old) =>
        old?.map((room) => (room.id === id ? { ...room, ...patch } : room))
      );
      return { previous };
    },
    onError: (err, vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast({
        title: vars.patch.name !== undefined ? "Could not rename room" : "Could not save box",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const create = useMutation({
    mutationFn: async (input: NewRoomInput): Promise<Room> => {
      if (!user) throw new Error("You need to be signed in to add rooms.");
      const { drawing } = input;
      // Same column defaults as analysed rooms, so exports and cards treat it identically.
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          drawing_id: drawing.id,
          project_id: drawing.project_id,
          floor_id: drawing.floor_id,
          user_id: user.id,
          name: input.name,
          floor_level: input.floorLevel,
          space_tag: "",
          room_type: input.roomType,
          area: null,
          area_unit: "sq ft",
          dimensions: {},
          bbox: input.bbox,
          floor_finish: "",
          flooring_size: "",
          flooring_finish: "",
          flooring_code: "",
          flooring_make: "",
          flooring_rate: "",
          skirting: "",
          skirting_code: "",
          skirting_make: "",
          skirting_rate: "",
          ceiling_finish: "",
          ceiling_material_2: "",
          ceiling_size: "",
          ceiling_code: "",
          ceiling_make: "",
          ceiling_rate: "",
          ceiling_height: null,
          wall_finish: "",
          dado: "",
          paint_color: "",
          remark: "",
          notes: MANUAL_ROOM_NOTE,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Room;
    },
    onSuccess: (room) => {
      queryClient.setQueryData<Room[]>(queryKey, (old) => (old ? [...old, room] : [room]));
      toast({ title: "Room added", description: `${room.name} is now in the schedule.` });
    },
    onError: (err) => {
      toast({ title: "Could not add room", description: errorMessage(err), variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // `mutate` / `mutateAsync` are referentially stable, so these callbacks are too.
  const { mutate } = update;
  const updateBox = useCallback(
    (id: string, bbox: BBox) => mutate({ id, patch: { bbox } }),
    [mutate]
  );
  const renameRoom = useCallback(
    (id: string, name: string) => mutate({ id, patch: { name } }),
    [mutate]
  );

  return {
    updateBox,
    renameRoom,
    /** Resolves with the saved room; rejects (after showing a toast) on failure. */
    createRoom: create.mutateAsync,
    isSaving: update.isPending,
    isCreating: create.isPending,
  };
}
