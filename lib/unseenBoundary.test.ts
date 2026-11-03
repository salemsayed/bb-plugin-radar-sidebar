import { expect, it } from "vitest";
import { unseenBoundary } from "./unseenBoundary";

it("finds the first unseen message by sequence, excluding work and duplicates", () => {
  expect(unseenBoundary(42, [
    { kind: "conversation", messageSeq: 42 },
    { kind: "work" },
    { kind: "turn", children: [{ kind: "conversation", messageSeq: 51 }, { kind: "conversation", messageSeq: 45 }] },
    { kind: "conversation", messageSeq: 51 },
  ])).toEqual({ firstSeq: 45, count: 2 });
});
it("does not invent a boundary for a first visit or a caught-up chat", () => {
  expect(unseenBoundary(null, [{ kind: "conversation", messageSeq: 10 }])).toBeNull();
  expect(unseenBoundary(42, [{ kind: "conversation", messageSeq: 42 }])).toBeNull();
});
