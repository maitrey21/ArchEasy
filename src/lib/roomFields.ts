/**
 * Field grouping for the clean room-wise views.
 *
 * These keys map 1:1 to the columns used by the Excel/SOF export
 * (see exportUtils.ts). We only change how the data is *presented* on the web —
 * the underlying room data and the exported spreadsheet are untouched.
 */
import type { Room } from "@/lib/types";

export interface FieldDef {
  key: keyof Room;
  label: string;
}

export interface FieldGroup {
  title: string;
  /** Tailwind text colour token for the group accent. */
  accent: string;
  fields: FieldDef[];
}

export const ROOM_FIELD_GROUPS: FieldGroup[] = [
  {
    title: "Flooring",
    accent: "text-primary",
    fields: [
      { key: "floor_finish", label: "Material" },
      { key: "flooring_size", label: "Size" },
      { key: "flooring_finish", label: "Finish" },
      { key: "flooring_code", label: "Code No" },
      { key: "flooring_make", label: "Make" },
      { key: "flooring_rate", label: "Basic Rate" },
    ],
  },
  {
    title: "Skirting",
    accent: "text-accent",
    fields: [
      { key: "skirting", label: "Material" },
      { key: "skirting_code", label: "Code No" },
      { key: "skirting_make", label: "Make" },
      { key: "skirting_rate", label: "Basic Rate" },
    ],
  },
  {
    title: "Ceiling",
    accent: "text-warning",
    fields: [
      { key: "ceiling_finish", label: "Material 1" },
      { key: "ceiling_material_2", label: "Material 2" },
      { key: "ceiling_size", label: "Size" },
      { key: "ceiling_code", label: "Code No" },
      { key: "ceiling_make", label: "Make" },
      { key: "ceiling_rate", label: "Basic Rate" },
      { key: "ceiling_height", label: "Ceiling Height" },
    ],
  },
  {
    title: "Walls",
    accent: "text-blueprint",
    fields: [
      { key: "wall_finish", label: "Wall Finish" },
      { key: "paint_color", label: "Paint / Colour" },
      { key: "dado", label: "Dado" },
    ],
  },
];

/** Value shown when a room field is empty, so the layout stays consistent. */
export const EMPTY_VALUE = "—";

/** Reads a room field as a display string, tolerating null/number values. */
export function fieldValue(room: Room, key: keyof Room): string {
  const raw = room[key];
  if (raw === null || raw === undefined || raw === "") return EMPTY_VALUE;
  return String(raw);
}

/** True when the room has at least one non-empty value in the group. */
export function groupHasData(room: Room, group: FieldGroup): boolean {
  return group.fields.some((f) => fieldValue(room, f.key) !== EMPTY_VALUE);
}

/** Human label for a room type tag. */
export function roomTypeLabel(roomType: string | null): string {
  if (!roomType) return "Space";
  return roomType.charAt(0).toUpperCase() + roomType.slice(1);
}

/** A short one-line summary of the key finishes, for card previews. */
export function finishSummary(room: Room): string {
  const parts = [room.floor_finish, room.wall_finish, room.ceiling_finish]
    .map((v) => (v ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : "No finishes recorded yet";
}
