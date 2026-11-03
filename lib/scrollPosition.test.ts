import { expect, it } from "vitest";
import { capturePosition, restoreDelta } from "./scrollPosition";

it("remembers a partially clipped top message instead of the newest visible message", () => {
  expect(capturePosition(400, 500, 2000, 50, [{ seq: 10, top: 10, bottom: 150 }, { seq: 11, top: 160, bottom: 600 }])).toEqual({ atBottom: false, messageSeq: 10, offset: -40 });
});
it("bottom has no anchor and preserves native following", () => {
  expect(capturePosition(1498, 500, 2000, 50, [])).toEqual({ atBottom: true, messageSeq: null, offset: 0 });
});
it("does not fabricate positions when anchors are absent", () => {
  expect(capturePosition(400, 500, 2000, 50, [])).toBeNull();
});
it("restores signed offsets after layout changes", () => {
  expect(restoreDelta(700, 50, -40)).toBe(690);
  expect(restoreDelta(10, 50, -40)).toBe(0);
});
