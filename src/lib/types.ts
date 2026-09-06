/**
 * Shared domain types for the app layer.
 *
 * These mirror the Supabase row shapes but stay hand-written so components can
 * depend on a narrow, readable contract instead of the generated helper types.
 */
import type { Json, Tables } from "@/integrations/supabase/types";

export type Project = Tables<"projects">;
export type Floor = Tables<"floors">;
export type Drawing = Tables<"drawings">;
export type Room = Tables<"rooms">;
export type RoomRecommendation = Tables<"room_recommendations">;

/** Normalised bounding box as stored on rooms.bbox: [ymin, xmin, ymax, xmax] on 0-1000. */
export type BBox = [number, number, number, number];

export function parseBBox(value: unknown): BBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((v) => Number(v));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = nums;
  if (ymax <= ymin || xmax <= xmin) return null;
  return [ymin, xmin, ymax, xmax];
}

export type RecommendationElement = "floor" | "wall" | "ceiling";
export type RecommendationStatus = "pending" | "accepted" | "rejected" | "edited";
export type AlternativeTier = "Budget" | "Standard" | "Premium";

export interface RecommendationAlternative {
  tier: AlternativeTier | string;
  material: string;
  make: string;
  finish: string;
  approx_rate: string;
  rationale: string;
}

export function parseAlternatives(value: unknown): RecommendationAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      tier: String(a.tier ?? ""),
      material: String(a.material ?? ""),
      make: String(a.make ?? ""),
      finish: String(a.finish ?? ""),
      approx_rate: String(a.approx_rate ?? ""),
      rationale: String(a.rationale ?? ""),
    }));
}

/** Which room column each recommendation element maps onto in the SOF. */
export const ELEMENT_TO_ROOM_COLUMN: Record<RecommendationElement, keyof Room> = {
  floor: "floor_finish",
  wall: "wall_finish",
  ceiling: "ceiling_finish",
};

export const ELEMENT_LABEL: Record<RecommendationElement, string> = {
  floor: "Flooring",
  wall: "Wall",
  ceiling: "Ceiling",
};

/** Safely extracts a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Something went wrong";
}

/** Postgres unique_violation, surfaced by Supabase as code 23505. */
export function isDuplicateKeyError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    if (String((err as { code: unknown }).code) === "23505") return true;
  }
  return /duplicate key/i.test(errorMessage(err));
}

/** A room object as returned by /api/analyze-drawing. */
export interface DetectedRoom {
  name?: string;
  floor_level?: string;
  space_tag?: string;
  room_type?: string;
  bbox?: number[];
  area?: number | null;
  ceiling_height?: number | null;
  dimensions?: Json;
  floor_finish?: string;
  flooring_finish?: string;
  flooring_code?: string;
  flooring_make?: string;
  flooring_rate?: string;
  skirting?: string;
  skirting_code?: string;
  skirting_make?: string;
  skirting_rate?: string;
  ceiling_finish?: string;
  ceiling_material_2?: string;
  ceiling_code?: string;
  ceiling_make?: string;
  ceiling_rate?: string;
  wall_finish?: string;
  paint_color?: string;
  dado?: string;
  remark?: string;
  notes?: string;
}

/** Full response body of /api/analyze-drawing. */
export interface AnalyzeDrawingResponse {
  success?: boolean;
  rooms?: DetectedRoom[];
  drawing_type?: string;
  summary?: string;
  label_count?: number;
  label_inventory?: string[];
  undetected_spaces?: string[];
  unmatched_labels?: string[];
  sweep_complete?: boolean | null;
  finish_reason?: string | null;
  analysis_feedback?: string;
  error?: string;
}

/** Structured detection metadata persisted on drawings.analysis_meta. */
export interface AnalysisMeta {
  label_count?: number;
  undetected_spaces?: string[];
  unmatched_labels?: string[];
  sweep_complete?: boolean | null;
  finish_reason?: string | null;
}

export function parseAnalysisMeta(value: unknown): AnalysisMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const toStrArray = (x: unknown): string[] =>
    Array.isArray(x) ? x.map((s) => String(s)).filter(Boolean) : [];
  return {
    label_count: typeof v.label_count === "number" ? v.label_count : undefined,
    undetected_spaces: toStrArray(v.undetected_spaces),
    unmatched_labels: toStrArray(v.unmatched_labels),
    sweep_complete: typeof v.sweep_complete === "boolean" ? v.sweep_complete : null,
    finish_reason: typeof v.finish_reason === "string" ? v.finish_reason : null,
  };
}

/**
 * Reads a fetch Response as JSON, but tolerates non-JSON bodies.
 *
 * A crashed or timed-out Vercel serverless function returns Vercel's own
 * HTML/text error page ("A server error has occurred...") instead of our
 * JSON shape. Calling `res.json()` directly on that throws a confusing
 * "Unexpected token 'A' ... is not valid JSON" error. This reads the body as
 * text first and surfaces a readable message when it isn't JSON.
 */
export async function readJsonResponse<T extends { error?: string }>(
  res: Response
): Promise<T> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const isPlatformCrash =
      /A server error has occurred|FUNCTION_INVOCATION|An error occurred with your deployment/i.test(
        raw
      );
    const message = isPlatformCrash
      ? "The server took too long or crashed while processing this request. Try a smaller file, or try again in a moment."
      : `Unexpected response from server (status ${res.status}).`;
    return { error: message } as T;
  }
}
