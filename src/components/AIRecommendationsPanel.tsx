import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles,
  Check,
  X,
  Pencil,
  ChevronDown,
  ArrowRight,
  RotateCcw,
  Loader2,
  Info,
  Wallet,
  Gem,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  parseAlternatives,
  ELEMENT_LABEL,
  type RecommendationElement,
  type RecommendationAlternative,
  type Room,
  type RoomRecommendation,
} from "@/lib/types";

interface Props {
  rooms: Room[];
  recommendations: RoomRecommendation[];
  isLoading: boolean;
  isGenerating: boolean;
  highlightedRoomId: string | null;
  onHighlightRoom: (id: string | null) => void;
  onGenerate: () => void;
  onAccept: (rec: RoomRecommendation, finishOverride?: string, tier?: string) => void;
  onReject: (recId: string) => void;
  onReopen: (recId: string) => void;
  /** Hidden in the whole-project view, where generation is per-floor. */
  canGenerate: boolean;
}

const tierIcon: Record<string, React.ElementType> = {
  Budget: Wallet,
  Standard: Scale,
  Premium: Gem,
};

const statusBadge: Record<string, { label: string; className: string }> = {
  pending: { label: "Needs review", className: "bg-warning/10 text-warning border-warning/20" },
  accepted: { label: "Accepted", className: "bg-success/10 text-success border-success/20" },
  edited: { label: "Edited", className: "bg-primary/10 text-primary border-primary/20" },
  rejected: { label: "Rejected", className: "bg-muted text-muted-foreground border-border" },
};

/** Qualitative rating pill. */
function Rating({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  const tone =
    value === "Very High" || value === "High"
      ? "text-success"
      : value === "Medium"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${tone}`}>{value}</span>
    </div>
  );
}

function RecommendationCard({
  rec,
  room,
  isHighlighted,
  onHighlightRoom,
  onAccept,
  onReject,
  onReopen,
}: {
  rec: RoomRecommendation;
  room: Room | undefined;
  isHighlighted: boolean;
  onHighlightRoom: (id: string | null) => void;
  onAccept: (rec: RoomRecommendation, finishOverride?: string, tier?: string) => void;
  onReject: (recId: string) => void;
  onReopen: (recId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(rec.recommended_finish ?? "");
  const [expanded, setExpanded] = useState(false);

  const alternatives = useMemo(() => parseAlternatives(rec.alternatives), [rec.alternatives]);
  const status = statusBadge[rec.status] ?? statusBadge.pending;
  const elementLabel = ELEMENT_LABEL[rec.element as RecommendationElement] ?? rec.element;
  const isResolved = rec.status !== "pending";

  const detected = (rec.detected_finish ?? "").trim();
  const recommended = (rec.recommended_finish ?? "").trim();
  const unchanged =
    detected.toLowerCase() === recommended.toLowerCase() && detected.length > 0;

  const applyAlternative = (alt: RecommendationAlternative) => {
    const value = [alt.material, alt.finish].filter(Boolean).join(" - ");
    onAccept(rec, value, alt.tier);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onMouseEnter={() => room && onHighlightRoom(room.id)}
      onMouseLeave={() => onHighlightRoom(null)}
      className={`rounded-lg border bg-card p-3 transition-all ${
        isHighlighted ? "border-primary/40 shadow-glow" : "border-border"
      } ${isResolved ? "opacity-80" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-foreground">
              {rec.room_id && room ? room.name : "Room"}
            </p>
            {room?.space_tag && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
                {room.space_tag}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {elementLabel}
          </p>
        </div>
        <Badge variant="outline" className={`shrink-0 text-[9px] ${status.className}`}>
          {status.label}
        </Badge>
      </div>

      {/* Detected vs Recommended */}
      <div className="mt-2.5 space-y-1.5 rounded-md bg-muted/40 p-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Detected
          </p>
          <p className="text-[11px] leading-snug text-foreground/80">
            {detected || "Not specified"}
          </p>
        </div>
        <div className="flex justify-center">
          <ArrowRight className="h-3 w-3 rotate-90 text-muted-foreground/50" />
        </div>
        <div>
          <div className="flex items-center gap-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-primary">
              AI Recommended
            </p>
            {unchanged && (
              <span className="rounded bg-success/10 px-1 text-[8px] font-semibold text-success">
                ALREADY OK
              </span>
            )}
          </div>
          {isEditing ? (
            <div className="mt-1 flex items-center gap-1">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-7 text-[11px]"
                aria-label="Edit recommended finish"
                autoFocus
              />
              <Button
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  onAccept(rec, draft);
                  setIsEditing(false);
                }}
                aria-label="Save edited finish"
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  setDraft(rec.recommended_finish ?? "");
                  setIsEditing(false);
                }}
                aria-label="Cancel edit"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <p className="text-[11px] font-medium leading-snug text-foreground">
              {recommended || "—"}
            </p>
          )}
        </div>
      </div>

      {rec.final_finish && isResolved && rec.status !== "rejected" && (
        <p className="mt-1.5 text-[10px] text-success">
          Applied to schedule: <span className="font-medium">{rec.final_finish}</span>
          {rec.selected_tier ? ` (${rec.selected_tier})` : ""}
        </p>
      )}

      {/* Rationale */}
      {rec.rationale && (
        <div className="mt-2 flex items-start gap-1.5">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          <p className="text-[10px] leading-relaxed text-muted-foreground">{rec.rationale}</p>
        </div>
      )}

      {/* Actions */}
      {!isEditing && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {isResolved ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 gap-1 text-[11px]"
              onClick={() => onReopen(rec.id)}
            >
              <RotateCcw className="h-3 w-3" />
              Reopen
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                className="h-7 flex-1 gap-1 bg-success text-[11px] text-success-foreground hover:bg-success/90"
                onClick={() => onAccept(rec)}
                disabled={!recommended}
              >
                <Check className="h-3 w-3" />
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={() => {
                  setDraft(recommended);
                  setIsEditing(true);
                }}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => onReject(rec.id)}
              >
                <X className="h-3 w-3" />
                Reject
              </Button>
            </>
          )}
        </div>
      )}

      {/* Alternatives + ratings */}
      {(alternatives.length > 0 || rec.durability) && (
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button className="mt-2 flex w-full items-center justify-between rounded px-1 py-1 text-[10px] font-medium text-primary hover:bg-primary/5">
              <span>
                {alternatives.length > 0
                  ? `${alternatives.length} alternatives & properties`
                  : "Material properties"}
              </span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-2">
            {(rec.durability || rec.maintenance || rec.moisture_resistance || rec.slip_resistance) && (
              <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2">
                <Rating label="Durability" value={rec.durability} />
                <Rating label="Maintenance" value={rec.maintenance} />
                <Rating label="Moisture resistance" value={rec.moisture_resistance} />
                <Rating label="Slip resistance" value={rec.slip_resistance} />
                {rec.cost_band && (
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted-foreground">Cost band</span>
                    <span className="font-semibold text-foreground">{rec.cost_band}</span>
                  </div>
                )}
              </div>
            )}

            {alternatives.map((alt, i) => {
              const TierIcon = tierIcon[alt.tier] ?? Scale;
              return (
                <div
                  key={`${alt.tier}-${i}`}
                  className="rounded-md border border-border/60 bg-card p-2"
                >
                  <div className="flex items-center gap-1.5">
                    <TierIcon className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                      {alt.tier}
                    </span>
                    {alt.approx_rate && (
                      <span className="ml-auto text-[10px] font-medium tabular-nums text-muted-foreground">
                        {alt.approx_rate}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] font-medium leading-snug text-foreground">
                    {alt.material}
                    {alt.finish ? ` - ${alt.finish}` : ""}
                  </p>
                  {alt.make && (
                    <p className="text-[10px] text-muted-foreground">Make: {alt.make}</p>
                  )}
                  {alt.rationale && (
                    <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                      {alt.rationale}
                    </p>
                  )}
                  {!isResolved && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5 h-6 w-full text-[10px]"
                      onClick={() => applyAlternative(alt)}
                    >
                      Use this option
                    </Button>
                  )}
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
    </motion.div>
  );
}

export default function AIRecommendationsPanel({
  rooms,
  recommendations,
  isLoading,
  isGenerating,
  highlightedRoomId,
  onHighlightRoom,
  onGenerate,
  onAccept,
  onReject,
  onReopen,
  canGenerate,
}: Props) {
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("all");

  const roomsById = useMemo(() => {
    const map = new Map<string, Room>();
    rooms.forEach((r) => map.set(r.id, r));
    return map;
  }, [rooms]);

  const counts = useMemo(() => {
    const pending = recommendations.filter((r) => r.status === "pending").length;
    return {
      total: recommendations.length,
      pending,
      resolved: recommendations.length - pending,
    };
  }, [recommendations]);

  const visible = useMemo(() => {
    const list =
      filter === "pending"
        ? recommendations.filter((r) => r.status === "pending")
        : filter === "resolved"
          ? recommendations.filter((r) => r.status !== "pending")
          : recommendations;

    // Group by room so a room's floor/wall/ceiling cards sit together.
    return [...list].sort((a, b) => {
      const roomA = roomsById.get(a.room_id)?.name ?? "";
      const roomB = roomsById.get(b.room_id)?.name ?? "";
      if (roomA !== roomB) return roomA.localeCompare(roomB);
      const order = ["floor", "wall", "ceiling"];
      return order.indexOf(a.element) - order.indexOf(b.element);
    });
  }, [recommendations, filter, roomsById]);

  return (
    <div className="flex h-full flex-col border-l border-border bg-card">
      <div className="border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold font-heading text-foreground">AI Insights</h2>
          {counts.pending > 0 && (
            <Badge variant="outline" className="ml-auto border-warning/20 bg-warning/10 text-[10px] text-warning">
              {counts.pending} to review
            </Badge>
          )}
        </div>
        <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-relaxed text-muted-foreground">
          <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0" />
          AI-generated suggestions. Nothing changes your schedule until you accept it.
        </p>
      </div>

      {canGenerate && (
        <div className="border-b border-border p-3">
          <Button
            onClick={onGenerate}
            disabled={isGenerating || rooms.length === 0}
            className="w-full gap-2 gradient-primary text-primary-foreground"
            size="sm"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analysing {rooms.length} rooms...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {counts.total > 0 ? "Regenerate" : "Get"} Recommendations
              </>
            )}
          </Button>
          {rooms.length === 0 && (
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              Detect rooms first by uploading a drawing.
            </p>
          )}
        </div>
      )}

      {counts.total > 0 && (
        <div className="flex gap-1 border-b border-border px-3 py-2">
          {([
            ["all", `All ${counts.total}`],
            ["pending", `Pending ${counts.pending}`],
            ["resolved", `Done ${counts.resolved}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                filter === key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : counts.total === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs font-medium text-foreground">No recommendations yet</p>
            <p className="mt-1 max-w-[200px] text-[10px] leading-relaxed text-muted-foreground">
              {canGenerate
                ? "Generate suggestions to compare detected finishes against AI-recommended materials."
                : "Open a specific floor to generate material recommendations."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {visible.map((rec) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  room={roomsById.get(rec.room_id)}
                  isHighlighted={highlightedRoomId === rec.room_id}
                  onHighlightRoom={onHighlightRoom}
                  onAccept={onAccept}
                  onReject={onReject}
                  onReopen={onReopen}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
