/**
 * AI material recommendations for the rooms on a floor.
 *
 * Recommendations are advisory and never touch the Schedule of Finishes on
 * their own. Only an explicit Accept (or Edit-then-save) writes the chosen
 * finish back onto the room's SOF column.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  ELEMENT_TO_ROOM_COLUMN,
  errorMessage,
  type RecommendationElement,
  type Room,
  type RoomRecommendation,
} from "@/lib/types";
import type { TablesInsert } from "@/integrations/supabase/types";

type RecommendationInsert = TablesInsert<"room_recommendations">;

/** Keep batches under the server's 40-room cap. */
const BATCH_SIZE = 20;

interface GenerateArgs {
  rooms: Room[];
  projectId: string;
  floorId: string | null;
  projectName?: string;
  floorName?: string;
}

export function useRecommendations(projectId: string | undefined, floorId: string | null) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const recommendationsQuery = useQuery({
    queryKey: ["recommendations", projectId, floorId],
    enabled: !!projectId,
    queryFn: async () => {
      let query = supabase
        .from("room_recommendations")
        .select("*")
        .eq("project_id", projectId!);

      // A null floorId means the project-wide view: fetch everything.
      if (floorId) query = query.eq("floor_id", floorId);

      const { data, error } = await query.order("created_at", { ascending: true });
      if (error) throw error;
      return data as RoomRecommendation[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["recommendations", projectId] });
  };

  const generate = useMutation({
    mutationFn: async ({ rooms, projectId: pid, floorId: fid, projectName, floorName }: GenerateArgs) => {
      if (!user) throw new Error("Not signed in");
      if (rooms.length === 0) throw new Error("No rooms to analyse yet");

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Your session expired. Please sign in again.");

      // Chunk so large floors don't exceed the model's output ceiling.
      const batches: Room[][] = [];
      for (let i = 0; i < rooms.length; i += BATCH_SIZE) {
        batches.push(rooms.slice(i, i + BATCH_SIZE));
      }

      const rowsToUpsert: RecommendationInsert[] = [];
      let incompleteBatches = 0;

      for (const batch of batches) {
        const res = await fetch("/api/recommend-materials", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ rooms: batch, projectName, floorName }),
        });

        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.error || `Recommendation failed (${res.status})`);

        if (payload.incomplete) incompleteBatches++;

        for (const rec of payload.recommendations ?? []) {
          const room = batch[rec.room_index];
          if (!room) continue;

          rowsToUpsert.push({
            room_id: room.id,
            project_id: pid,
            floor_id: fid ?? room.floor_id ?? null,
            user_id: user.id,
            element: rec.element,
            detected_finish: rec.detected_finish ?? "",
            recommended_finish: rec.recommended_finish ?? "",
            rationale: rec.rationale ?? "",
            durability: rec.durability ?? "",
            maintenance: rec.maintenance ?? "",
            moisture_resistance: rec.moisture_resistance ?? "",
            slip_resistance: rec.slip_resistance ?? "",
            cost_band: rec.cost_band ?? "",
            alternatives: rec.alternatives ?? [],
            status: "pending",
            selected_tier: "",
            final_finish: "",
            ai_generated: true,
            model: payload.model ?? "",
          });
        }
      }

      if (rowsToUpsert.length === 0) {
        throw new Error("The AI did not return any usable recommendations. Please retry.");
      }

      // Re-running replaces the previous suggestion for the same room+element.
      const { error } = await supabase
        .from("room_recommendations")
        .upsert(rowsToUpsert, { onConflict: "room_id,element" });
      if (error) throw error;

      return { count: rowsToUpsert.length, incompleteBatches };
    },
    onSuccess: ({ count, incompleteBatches }) => {
      invalidate();
      toast({
        title: `${count} recommendation${count === 1 ? "" : "s"} generated`,
        description: incompleteBatches
          ? "Some rooms may be missing suggestions - run again to fill the gaps."
          : "Review each one and accept, edit or reject it.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Could not generate recommendations",
        description: errorMessage(err),
        variant: "destructive",
      });
    },
  });

  /**
   * Accepts a recommendation and writes the chosen finish into the room's SOF
   * column. `finishOverride` carries an architect-edited value.
   */
  const accept = useMutation({
    mutationFn: async ({
      recommendation,
      finishOverride,
      tier,
    }: {
      recommendation: RoomRecommendation;
      finishOverride?: string;
      tier?: string;
    }) => {
      const finish = (finishOverride ?? recommendation.recommended_finish ?? "").trim();
      if (!finish) throw new Error("Nothing to apply - the finish is empty");

      const edited = finishOverride !== undefined && finishOverride !== recommendation.recommended_finish;

      const { error: recError } = await supabase
        .from("room_recommendations")
        .update({
          status: edited ? "edited" : "accepted",
          final_finish: finish,
          selected_tier: tier ?? recommendation.selected_tier ?? "",
        })
        .eq("id", recommendation.id);
      if (recError) throw recError;

      // Apply onto the matching SOF column for this element.
      const column = ELEMENT_TO_ROOM_COLUMN[recommendation.element as RecommendationElement];
      if (!column) throw new Error(`Unknown element: ${recommendation.element}`);

      const { error: roomError } = await supabase
        .from("rooms")
        .update({ [column]: finish })
        .eq("id", recommendation.room_id);
      if (roomError) throw roomError;

      return { edited };
    },
    onSuccess: ({ edited }) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["rooms", projectId] });
      toast({
        title: edited ? "Edited finish applied" : "Recommendation accepted",
        description: "The Schedule of Finishes has been updated.",
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Could not apply", description: errorMessage(err), variant: "destructive" });
    },
  });

  const reject = useMutation({
    mutationFn: async (recommendationId: string) => {
      const { error } = await supabase
        .from("room_recommendations")
        .update({ status: "rejected", final_finish: "" })
        .eq("id", recommendationId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({
        title: "Recommendation rejected",
        description: "The Schedule of Finishes was left unchanged.",
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Could not reject", description: errorMessage(err), variant: "destructive" });
    },
  });

  const resetToPending = useMutation({
    mutationFn: async (recommendationId: string) => {
      const { error } = await supabase
        .from("room_recommendations")
        .update({ status: "pending", final_finish: "", selected_tier: "" })
        .eq("id", recommendationId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Recommendation reopened" });
    },
  });

  return {
    recommendations: recommendationsQuery.data ?? [],
    isLoading: recommendationsQuery.isLoading,
    generate,
    accept,
    reject,
    resetToPending,
  };
}
