import { useMemo, useState } from "react";
import {
  DoorOpen,
  Check,
  X,
  Pencil,
  ArrowRight,
  RotateCcw,
  Wallet,
  Gem,
  Scale,
  ChevronDown,
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
  type RecommendationAlternative,
  type RecommendationElement,
  type Room,
  type RoomRecommendation,
} from "@/lib/types";
import { roomTypeLabel } from "@/lib/roomFields";

interface Props {
  room: Room;
  recommendations: RoomRecommendation[];
  onAccept: (rec: RoomRecommendation, finishOverride?: string, tier?: string) => void;
  onReject: (recId: string) => void;
  onReopen: (recId: string) => void;
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

/** Preferred element order so Flooring / Wall / Ceiling always line up. */
const ELEMENT_ORDER: RecommendationElement[] = ["floor", "wall", "ceiling"];

function Rating({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  const tone =
    value === "Very High" || value === "High"
      ? "text-success"
      : value === "Medium"
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${tone}`}>{value}</span>
    </div>
  );
}

function ElementCard({
  rec,
  onAccept,
  onReject,
  onReopen,
}: {
  rec: RoomRecommendation;
  onAccept: (rec: RoomRecommendation, finishOverride?: string, tier?: string) => void;
  onReject: (recId: string) => void;
  onReopen: (recId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(rec.recommended_finish ?? "");
  const [showAlts, setShowAlts] = useState(false);

  const alternatives = useMemo(() => parseAlternatives(rec.alternatives), [rec.alternatives]);
  const status = statusBadge[rec.status] ?? statusBadge.pending;
  const elementLabel = ELEMENT_LABEL[rec.element as RecommendationElement] ?? rec.element;
  const isResolved = rec.status !== "pending";

  const detected = (rec.detected_finish ?? "").trim();
  const recommended = (rec.recommended_finish ?? "").trim();
  const unchanged = detected.toLowerCase() === recommended.toLowerCase() && detected.length > 0;

  const applyAlternative = (alt: RecommendationAlternative) => {
    const value = [alt.material, alt.finish].filter(Boolean).join(" - ");
    onAccept(rec, value, alt.tier);
  };

  return (
    <div
      className={`flex flex-col rounded-lg border bg-card p-3 ${
        isResolved ? "border-border opacity-90" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-foreground">
          {elementLabel}
        </span>
        <Badge variant="outline" className={`text-[9px] ${status.className}`}>
          {status.label}
        </Badge>
      </div>

      {/* Detected -> Recommended */}
      <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Detected
          </p>
          <p className="text-[11px] leading-snug text-foreground/80">{detected || "Not specified"}</p>
        </div>
        <ArrowRight className="mx-auto h-3 w-3 rotate-90 text-muted-foreground/50" />
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
          Applied: <span className="font-medium">{rec.final_finish}</span>
          {rec.selected_tier ? ` (${rec.selected_tier})` : ""}
        </p>
      )}

      {rec.rationale && (
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{rec.rationale}</p>
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
                aria-label="Edit recommendation"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => onReject(rec.id)}
                aria-label="Reject recommendation"
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      )}

      {/* Alternatives + ratings */}
      {(alternatives.length > 0 || rec.durability) && (
        <Collapsible open={showAlts} onOpenChange={setShowAlts}>
          <CollapsibleTrigger asChild>
            <button className="mt-2 flex w-full items-center justify-between rounded px-1 py-1 text-[10px] font-medium text-primary hover:bg-primary/5">
              <span>
                {alternatives.length > 0
                  ? `${alternatives.length} options & properties`
                  : "Properties"}
              </span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showAlts ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5 space-y-2">
            {(rec.durability || rec.maintenance || rec.moisture_resistance || rec.slip_resistance) && (
              <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-2 text-[11px]">
                <Rating label="Durability" value={rec.durability} />
                <Rating label="Maintenance" value={rec.maintenance} />
                <Rating label="Moisture resistance" value={rec.moisture_resistance} />
                <Rating label="Slip resistance" value={rec.slip_resistance} />
                {rec.cost_band && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Cost band</span>
                    <span className="font-semibold text-foreground">{rec.cost_band}</span>
                  </div>
                )}
              </div>
            )}

            {alternatives.map((alt, i) => {
              const TierIcon = tierIcon[alt.tier] ?? Scale;
              return (
                <div key={`${alt.tier}-${i}`} className="rounded-md border border-border/60 bg-card p-2">
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
                  {alt.make && <p className="text-[10px] text-muted-foreground">Make: {alt.make}</p>}
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
    </div>
  );
}

/**
 * All recommendations for one room, laid out element-wise (Flooring / Wall /
 * Ceiling) so an architect reviews a room as a single unit.
 */
export default function RoomRecommendationGroup({
  room,
  recommendations,
  onAccept,
  onReject,
  onReopen,
}: Props) {
  const ordered = useMemo(
    () =>
      [...recommendations].sort(
        (a, b) =>
          ELEMENT_ORDER.indexOf(a.element as RecommendationElement) -
          ELEMENT_ORDER.indexOf(b.element as RecommendationElement)
      ),
    [recommendations]
  );

  const pending = recommendations.filter((r) => r.status === "pending").length;

  return (
    <section className="rounded-xl border border-border bg-card/50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blueprint-light">
          <DoorOpen className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-semibold font-heading text-foreground">{room.name}</h3>
          <p className="text-[11px] text-muted-foreground">
            {roomTypeLabel(room.room_type)}
            {room.space_tag ? ` · ${room.space_tag}` : ""}
            {room.floor_level ? ` · ${room.floor_level}` : ""}
          </p>
        </div>
        {pending > 0 && (
          <Badge variant="outline" className="ml-auto border-warning/20 bg-warning/10 text-[10px] text-warning">
            {pending} to review
          </Badge>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((rec) => (
          <ElementCard
            key={rec.id}
            rec={rec}
            onAccept={onAccept}
            onReject={onReject}
            onReopen={onReopen}
          />
        ))}
      </div>
    </section>
  );
}
