import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Sparkles,
  Building2,
  Loader2,
  Info,
  ClipboardList,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import RoomRecommendationGroup from "@/components/RoomRecommendationGroup";
import { useFloors } from "@/hooks/useFloors";
import { useRecommendations } from "@/hooks/useRecommendations";
import type { Room } from "@/lib/types";

export default function AIRecommendations() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { floors, activeFloorId, setActiveFloorId } = useFloors(id);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "resolved">("all");

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: rooms = [] } = useQuery({
    queryKey: ["rooms", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("*")
        .eq("project_id", id!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Room[];
    },
  });

  const activeFloor = floors.find((f) => f.id === activeFloorId) ?? null;

  const { recommendations, isLoading, generate, accept, reject, resetToPending } =
    useRecommendations(id, activeFloorId);

  const floorRooms = useMemo(
    () => rooms.filter((r) => r.floor_id === activeFloorId),
    [rooms, activeFloorId]
  );

  const roomsById = useMemo(() => {
    const map = new Map<string, Room>();
    floorRooms.forEach((r) => map.set(r.id, r));
    return map;
  }, [floorRooms]);

  /** Group recommendations by room, preserving room order, applying the filter. */
  const grouped = useMemo(() => {
    const filtered = recommendations.filter((rec) => {
      if (statusFilter === "pending") return rec.status === "pending";
      if (statusFilter === "resolved") return rec.status !== "pending";
      return true;
    });

    const byRoom = new Map<string, typeof filtered>();
    filtered.forEach((rec) => {
      const list = byRoom.get(rec.room_id) ?? [];
      list.push(rec);
      byRoom.set(rec.room_id, list);
    });

    // Order by the room's own ordering; drop groups whose room isn't on this floor.
    return floorRooms
      .filter((room) => byRoom.has(room.id))
      .map((room) => ({ room, recs: byRoom.get(room.id)! }));
  }, [recommendations, statusFilter, floorRooms]);

  const counts = useMemo(() => {
    const pending = recommendations.filter((r) => r.status === "pending").length;
    return { total: recommendations.length, pending, resolved: recommendations.length - pending };
  }, [recommendations]);

  const projectName = project?.name ?? "Project";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/project/${id}`)}
            aria-label="Back to project"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold font-heading leading-tight text-foreground">
              AI Recommendations
            </h1>
            <p className="flex items-center gap-1 truncate text-[11px] leading-tight text-muted-foreground">
              <Building2 className="h-2.5 w-2.5" />
              {projectName}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {floors.length > 0 && (
              <Select value={activeFloorId ?? undefined} onValueChange={setActiveFloorId}>
                <SelectTrigger className="h-9 w-[150px] text-xs">
                  <SelectValue placeholder="Select floor" />
                </SelectTrigger>
                <SelectContent>
                  {floors.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={() =>
                generate.mutate({
                  rooms: floorRooms,
                  projectId: id!,
                  floorId: activeFloorId,
                  projectName,
                  floorName: activeFloor?.name,
                })
              }
              disabled={generate.isPending || floorRooms.length === 0 || !user}
              size="sm"
              className="gap-1.5 gradient-primary text-primary-foreground"
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="hidden sm:inline">Analysing…</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {counts.total > 0 ? "Regenerate" : "Generate"}
                  </span>
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Disclaimer */}
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            These are <span className="font-medium text-foreground">AI-generated</span> suggestions
            grouped by room. Comparing the detected finish against a recommended one, with
            Budget / Standard / Premium options. Nothing changes your Schedule of Finishes until you
            accept a recommendation.
          </p>
        </div>

        {/* Filters */}
        {counts.total > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {activeFloor?.name ?? "Floor"} · {counts.total} recommendation
              {counts.total === 1 ? "" : "s"}
            </span>
            <div className="ml-auto inline-flex items-center rounded-lg border border-border bg-card p-0.5">
              {(
                [
                  ["all", `All ${counts.total}`],
                  ["pending", `Pending ${counts.pending}`],
                  ["resolved", `Done ${counts.resolved}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    statusFilter === key
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Body */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : floorRooms.length === 0 ? (
          <EmptyState
            title="No rooms on this floor"
            body="Upload a drawing on this floor first — the AI extracts rooms, then you can generate material recommendations for each one."
            cta={
              <Button variant="outline" size="sm" onClick={() => navigate(`/project/${id}`)}>
                Go to project
              </Button>
            }
          />
        ) : counts.total === 0 ? (
          <EmptyState
            title="No recommendations yet"
            body={`${floorRooms.length} room${floorRooms.length === 1 ? "" : "s"} ready on ${
              activeFloor?.name ?? "this floor"
            }. Generate AI material recommendations to compare against the detected finishes.`}
            cta={
              <Button
                onClick={() =>
                  generate.mutate({
                    rooms: floorRooms,
                    projectId: id!,
                    floorId: activeFloorId,
                    projectName,
                    floorName: activeFloor?.name,
                  })
                }
                disabled={generate.isPending}
                className="gap-1.5 gradient-primary text-primary-foreground"
                size="sm"
              >
                <Sparkles className="h-4 w-4" />
                Generate recommendations
              </Button>
            }
          />
        ) : grouped.length === 0 ? (
          <EmptyState
            title="Nothing matches this filter"
            body="Try switching the filter back to All."
          />
        ) : (
          <div className="space-y-4">
            {grouped.map(({ room, recs }, idx) => (
              <motion.div
                key={room.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.03, 0.3) }}
              >
                <RoomRecommendationGroup
                  room={room}
                  recommendations={recs}
                  onAccept={(rec, finishOverride, tier) =>
                    accept.mutate({ recommendation: rec, finishOverride, tier })
                  }
                  onReject={(recId) => reject.mutate(recId)}
                  onReopen={(recId) => resetToPending.mutate(recId)}
                />
              </motion.div>
            ))}

            {counts.pending === 0 && (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-success/20 bg-success/5 py-3 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" />
                Every recommendation on this floor has been reviewed.
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <ClipboardList className="h-6 w-6 text-primary" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{body}</p>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
