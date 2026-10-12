import { describe, it, expect } from "vitest";
import {
  adjustBox,
  boxFromPoints,
  boxesEqual,
  isDrawableBox,
  roundBox,
} from "@/lib/bboxEdit";

describe("bboxEdit", () => {
  it("computes bounding boxes correctly from diagonal points", () => {
    const box = boxFromPoints(100, 200, 300, 400);
    expect(box).toEqual([200, 100, 400, 300]);
  });

  it("handles reversed coordinate order", () => {
    const box = boxFromPoints(300, 400, 100, 200);
    expect(box).toEqual([200, 100, 400, 300]);
  });

  it("detects drawable boxes vs noise clicks", () => {
    expect(isDrawableBox([100, 100, 200, 200])).toBe(true);
    expect(isDrawableBox([100, 100, 102, 102])).toBe(false);
  });

  it("rounds box coordinates cleanly", () => {
    expect(roundBox([10.123, 20.456, 30.789, 40.111])).toEqual([10.1, 20.5, 30.8, 40.1]);
  });

  it("adjusts boxes via move handle without changing size", () => {
    const start: [number, number, number, number] = [100, 100, 200, 250];
    const moved = adjustBox(start, "move", 50, 30);
    expect(moved[0]).toBe(130);
    expect(moved[1]).toBe(150);
    expect(moved[2] - moved[0]).toBe(start[2] - start[0]);
    expect(moved[3] - moved[1]).toBe(start[3] - start[1]);
  });
});
