import { useMemo } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  SearchX,
  HelpCircle,
  FileText,
} from "lucide-react";
import { parseAnalysisMeta, type Drawing, type Room } from "@/lib/types";

interface Props {
  drawings: Drawing[];
  rooms: Room[];
}

interface DrawingSummary {
  drawing: Drawing;
  detected: number;
  undetected: string[];
  unmatched: string[];
  labelCount: number;
  endedEarly: boolean;
}

/**
 * Fallback parser for drawings uploaded before analysis_meta existed: pull the
 * uncertain items out of the free-text analysis_feedback.
 */
function undetectedFromFeedback(feedback: string): string[] {
  if (!feedback) return [];
  const lines = feedback.split(/\n+/).map((l) => l.trim());
  const items: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (/could not detect|flagged as uncertain|no matching row|need verification/i.test(line)) {
      capturing = true;
      // A trailing inline list ("...: a, b, c") is captured directly.
      const colon = line.split(":").slice(1).join(":").trim();
      if (colon) colon.split(/,\s*/).forEach((s) => s && items.push(s.replace(/\.$/, "")));
      continue;
    }
    if (capturing) {
      const m = line.match(/^\d+\.\s*(.+)$/);
      if (m) items.push(m[1].trim());
      else if (line.length === 0) capturing = false;
    }
  }
  return items;
}

export default function DetectionSummary({ drawings, rooms }: Props) {
  const summaries = useMemo<DrawingSummary[]>(() => {
    return drawings
      .filter((d) => d.analysis_status === "completed" || d.analysis_feedback)
      .map((d) => {
        const meta = parseAnalysisMeta(d.analysis_meta);
        const detected = rooms.filter((r) => r.drawing_id === d.id).length;

        const undetected = meta?.undetected_spaces?.length
          ? meta.undetected_spaces
          : undetectedFromFeedback(d.analysis_feedback ?? "");
        const unmatched = meta?.unmatched_labels ?? [];

        return {
          drawing: d,
          detected,
          undetected,
          unmatched,
          labelCount: meta?.label_count ?? 0,
          endedEarly: !!meta?.finish_reason && meta.finish_reason !== "STOP",
        };
      });
  }, [drawings, rooms]);

  if (summaries.length === 0) return null;

  const totalGaps = summaries.reduce((n, s) => n + s.undetected.length + s.unmatched.length, 0);

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            totalGaps > 0 ? "bg-warning/10" : "bg-success/10"
          }`}
        >
          {totalGaps > 0 ? (
            <AlertTriangle className="h-4 w-4 text-warning" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold font-heading text-foreground">
            Detection Summary
          </h3>
          <p className="text-xs text-muted-foreground">
            {totalGaps > 0
              ? `${totalGaps} space${totalGaps === 1 ? "" : "s"} may need manual verification`
              : "Every label read from the drawings was matched to a room"}
          </p>
        </div>
      </header>

      <div className="divide-y divide-border">
        {summaries.map(({ drawing, detected, undetected, unmatched, labelCount, endedEarly }) => {
          const clean = undetected.length === 0 && unmatched.length === 0;
          return (
            <div key={drawing.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium text-foreground" title={drawing.file_name}>
                  {drawing.file_name}
                </span>
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success">
                    {detected} detected
                  </span>
                  {labelCount > 0 && <span>of {labelCount} labels</span>}
                </span>
              </div>

              {clean ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All visible spaces were detected and scheduled.
                </p>
              ) : (
                <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                  {undetected.length > 0 && (
                    <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <SearchX className="h-3.5 w-3.5 text-warning" />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-warning">
                          Not detected ({undetected.length})
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {undetected.map((item, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/85">
                            <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning" />
                            <span className="leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {unmatched.length > 0 && (
                    <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <HelpCircle className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                          Labels to verify ({unmatched.length})
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {unmatched.map((label, i) => (
                          <span
                            key={i}
                            className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {endedEarly && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  The AI response ended early on this sheet — very dense drawings may need to be
                  split per zone for complete coverage.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
