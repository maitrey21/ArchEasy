/**
 * Floor management for a project.
 *
 * A project owns an ordered list of floors; each floor owns its own drawings,
 * rooms and therefore its own Schedule of Finishes. Deleting a floor cascades
 * to its drawings and rooms in the database.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { errorMessage, isDuplicateKeyError, type Floor } from "@/lib/types";

/** Conventional floor names, offered in order as the user adds floors. */
const FLOOR_NAME_SEQUENCE = [
  "Ground Floor",
  "First Floor",
  "Second Floor",
  "Third Floor",
  "Fourth Floor",
  "Fifth Floor",
  "Sixth Floor",
  "Seventh Floor",
  "Eighth Floor",
  "Ninth Floor",
  "Tenth Floor",
];

function suggestFloorName(existing: Floor[]): string {
  const taken = new Set(existing.map((f) => f.name.trim().toLowerCase()));

  for (const name of FLOOR_NAME_SEQUENCE) {
    if (!taken.has(name.toLowerCase())) return name;
  }

  // Past the named sequence, fall back to numbered levels.
  let n = existing.length + 1;
  while (taken.has(`level ${n}`.toLowerCase())) n++;
  return `Level ${n}`;
}

export function useFloors(projectId: string | undefined) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeFloorId, setActiveFloorId] = useState<string | null>(null);

  const floorsQuery = useQuery({
    queryKey: ["floors", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floors")
        .select("*")
        .eq("project_id", projectId!)
        .order("level_index", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Floor[];
    },
  });

  // Memoised so the empty-array fallback doesn't create a new reference on
  // every render and retrigger the effect/memo below.
  const floors = useMemo(() => floorsQuery.data ?? [], [floorsQuery.data]);

  // Keep a valid floor selected: pick the first one initially, and recover if
  // the active floor is deleted.
  useEffect(() => {
    if (floors.length === 0) {
      if (activeFloorId !== null) setActiveFloorId(null);
      return;
    }
    if (!activeFloorId || !floors.some((f) => f.id === activeFloorId)) {
      setActiveFloorId(floors[0].id);
    }
  }, [floors, activeFloorId]);

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? null,
    [floors, activeFloorId]
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["floors", projectId] });
    queryClient.invalidateQueries({ queryKey: ["drawings", projectId] });
    queryClient.invalidateQueries({ queryKey: ["rooms", projectId] });
    queryClient.invalidateQueries({ queryKey: ["recommendations", projectId] });
  };

  const addFloor = useMutation({
    mutationFn: async (name?: string) => {
      if (!projectId || !user) throw new Error("Not ready");

      const nextIndex = floors.length
        ? Math.max(...floors.map((f) => f.level_index)) + 1
        : 0;

      const { data, error } = await supabase
        .from("floors")
        .insert({
          project_id: projectId,
          user_id: user.id,
          name: name?.trim() || suggestFloorName(floors),
          level_index: nextIndex,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Floor;
    },
    onSuccess: (floor) => {
      invalidate();
      setActiveFloorId(floor.id);
      toast({ title: `${floor.name} added` });
    },
    onError: (err: unknown) => {
      const duplicate = isDuplicateKeyError(err);
      toast({
        title: duplicate ? "That floor name is already used" : "Could not add floor",
        description: duplicate ? "Pick a different name for this floor." : errorMessage(err),
        variant: "destructive",
      });
    },
  });

  const renameFloor = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Floor name cannot be empty");

      const { error } = await supabase.from("floors").update({ name: trimmed }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Floor renamed" });
    },
    onError: (err: unknown) => {
      const duplicate = isDuplicateKeyError(err);
      toast({
        title: duplicate ? "That floor name is already used" : "Could not rename floor",
        description: duplicate ? "Pick a different name for this floor." : errorMessage(err),
        variant: "destructive",
      });
    },
  });

  const deleteFloor = useMutation({
    mutationFn: async (id: string) => {
      // Clean up storage objects first; the DB cascade removes the rows but not
      // the uploaded files.
      const { data: floorDrawings } = await supabase
        .from("drawings")
        .select("storage_path")
        .eq("floor_id", id);

      const paths = (floorDrawings ?? []).map((d) => d.storage_path).filter(Boolean);
      if (paths.length > 0) {
        await supabase.storage.from("drawings").remove(paths);
      }

      const { error } = await supabase.from("floors").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Floor deleted" });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not delete floor",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
  });

  /**
   * Projects created before multi-floor support (or brand new ones) have no
   * floors. Create a default so the UI always has somewhere to put a drawing.
   */
  const ensureDefaultFloor = useMutation({
    mutationFn: async () => {
      if (!projectId || !user) throw new Error("Not ready");

      const { data: existing } = await supabase
        .from("floors")
        .select("id")
        .eq("project_id", projectId)
        .limit(1);

      if (existing && existing.length > 0) return null;

      const { data, error } = await supabase
        .from("floors")
        .insert({
          project_id: projectId,
          user_id: user.id,
          name: "Ground Floor",
          level_index: 0,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Floor;
    },
    onSuccess: (floor) => {
      if (floor) {
        invalidate();
        setActiveFloorId(floor.id);
      }
    },
  });

  return {
    floors,
    isLoading: floorsQuery.isLoading,
    error: floorsQuery.error,
    activeFloor,
    activeFloorId,
    setActiveFloorId,
    addFloor,
    renameFloor,
    deleteFloor,
    ensureDefaultFloor,
    suggestedName: suggestFloorName(floors),
  };
}
