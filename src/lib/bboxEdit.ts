/**
 * Geometry for editing room bounding boxes in the drawing viewer.
 *
 * Boxes use the stored convention: [ymin, xmin, ymax, xmax] on a 0-1000 sheet
 * scale. Every function here is pure so it can be unit-tested without a DOM.
 */
import type { BBox } from "@/lib/types";

export const BBOX_SCALE = 1000;

/** Smallest box edge allowed while resizing (0.8 % of the sheet). */
export const MIN_BOX_SIZE = 8;

/** Which part of the box is being dragged. Compass points are resize handles. */
export type BoxHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_HANDLES: Exclude<BoxHandle, "move">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Applies a drag of (dx, dy) sheet units to a box via the given handle.
 * The result always stays inside the sheet and never inverts or collapses.
 */
export function adjustBox(
  box: BBox,
  handle: BoxHandle,
  dx: number,
  dy: number,
  minSize: number = MIN_BOX_SIZE
): BBox {
  const [ymin, xmin, ymax, xmax] = box;
  const height = ymax - ymin;
  const width = xmax - xmin;

  if (handle === "move") {
    const top = clamp(ymin + dy, 0, BBOX_SCALE - height);
    const left = clamp(xmin + dx, 0, BBOX_SCALE - width);
    return [top, left, top + height, left + width];
  }

  // A box that is already smaller than the minimum may keep its size, not grow.
  const minH = Math.min(minSize, height);
  const minW = Math.min(minSize, width);
  const north = handle === "n" || handle === "ne" || handle === "nw";
  const south = handle === "s" || handle === "se" || handle === "sw";
  const west = handle === "w" || handle === "nw" || handle === "sw";
  const east = handle === "e" || handle === "ne" || handle === "se";

  return [
    north ? clamp(ymin + dy, 0, ymax - minH) : ymin,
    west ? clamp(xmin + dx, 0, xmax - minW) : xmin,
    south ? clamp(ymax + dy, ymin + minH, BBOX_SCALE) : ymax,
    east ? clamp(xmax + dx, xmin + minW, BBOX_SCALE) : xmax,
  ];
}

/** Rounds to 0.1 sheet units so stored values stay compact but precise at high zoom. */
export function roundBox(box: BBox): BBox {
  return box.map((v) => Math.round(v * 10) / 10) as BBox;
}

export function boxesEqual(a: BBox, b: BBox, epsilon = 0.05): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= epsilon);
}

/** Converts a pointer delta in screen pixels to sheet units, given the overlay's on-screen size. */
export function pixelsToSheet(
  deltaX: number,
  deltaY: number,
  layerWidth: number,
  layerHeight: number
): { dx: number; dy: number } {
  return {
    dx: layerWidth > 0 ? (deltaX / layerWidth) * BBOX_SCALE : 0,
    dy: layerHeight > 0 ? (deltaY / layerHeight) * BBOX_SCALE : 0,
  };
}

/** Cursor that matches each handle, for the resize affordance. */
export const HANDLE_CURSOR: Record<BoxHandle, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** Box spanning two sheet-unit points (any drag direction), clamped to the sheet. */
export function boxFromPoints(ax: number, ay: number, bx: number, by: number): BBox {
  const c = (v: number) => clamp(v, 0, BBOX_SCALE);
  return [c(Math.min(ay, by)), c(Math.min(ax, bx)), c(Math.max(ay, by)), c(Math.max(ax, bx))];
}

/** A drawn box is kept only if it is big enough in both directions (filters stray clicks). */
export function isDrawableBox(box: BBox, minSize: number = MIN_BOX_SIZE): boolean {
  return box[2] - box[0] >= minSize && box[3] - box[1] >= minSize;
}

/** Default box at the sheet centre, used when adding a box from the keyboard. */
export function centredBox(size = 120): BBox {
  const half = size / 2;
  const mid = BBOX_SCALE / 2;
  return [mid - half, mid - half, mid + half, mid + half];
}

/**
 * Names worth offering when the user draws a new box: labels the analysis read
 * but could not place, minus any that already exist as rooms.
 */
export function labelSuggestions(
  candidates: string[],
  existingNames: string[],
  limit = 12
): string[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const taken = new Set(existingNames.map(norm));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const label = raw.replace(/\s+/g, " ").trim();
    const key = norm(label);
    if (!key || taken.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

/** Normalises a typed room name; returns null when there is nothing worth saving. */
export function cleanRoomName(value: string, current: string): string | null {
  const next = value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!next || next === current) return null;
  return next;
}
