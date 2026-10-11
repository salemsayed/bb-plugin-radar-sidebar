import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freezeLayout, useFrozenOrder, useOrderFreeze, type OrderLayout } from "./useFrozenOrder";

interface Row { id: string; title: string }
interface Group { id: string; roots: Row[]; total: number }
type Layout = OrderLayout<Row, Group>;

const row = (id: string, title = id): Row => ({ id, title });
const group = (id: string, roots: Row[]): Group => ({ id, roots, total: roots.length });
const regroup = (base: Group, roots: Row[]): Group => group(base.id, roots);
const layout = (groups: Group[], children = new Map<string, Row[]>()): Layout => ({
  regions: [[], groups],
  children,
});
const ids = (value: Layout) => value.regions.map((region) => region.map((g) => `${g.id}:${g.roots.map((r) => r.id).join(",")}`));

function useHarness(latest: Layout) {
  const freeze = useOrderFreeze();
  return { freeze, layout: useFrozenOrder(latest, freeze.frozen, regroup, "view") };
}

const mouse = { pointerType: "mouse" };

describe("useFrozenOrder", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const before = layout([group("today", [row("a"), row("b"), row("c")]), group("yesterday", [row("d")])]);
  // c went live (floats first) and b was renamed.
  const after = layout([group("today", [row("c"), row("a"), row("b", "B renamed")]), group("yesterday", [row("d")])]);

  it("holds the order while hovered but shows the latest data", () => {
    const hook = renderHook(({ latest }) => useHarness(latest), { initialProps: { latest: before } });
    act(() => hook.result.current.freeze.handlers.onPointerEnter(mouse));
    hook.rerender({ latest: after });
    expect(ids(hook.result.current.layout)).toEqual([[], ["today:a,b,c", "yesterday:d"]]);
    expect(hook.result.current.layout.regions[1]![0]!.roots[1]!.title).toBe("B renamed");
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(ids(hook.result.current.layout)).toEqual([[], ["today:a,b,c", "yesterday:d"]]);
  });

  it("appends a new thread at the end of its group while frozen", () => {
    const hook = renderHook(({ latest }) => useHarness(latest), { initialProps: { latest: before } });
    act(() => hook.result.current.freeze.handlers.onPointerEnter(mouse));
    hook.rerender({ latest: layout([group("today", [row("new"), row("c"), row("a"), row("b")]), group("yesterday", [row("d")])]) });
    const today = hook.result.current.layout.regions[1]![0]!;
    expect(today.roots.map((r) => r.id)).toEqual(["a", "b", "c", "new"]);
    // Counts are rebuilt for what the group holds.
    expect(today.total).toBe(4);
  });

  it("commits the new order only after the pointer leaves and stays idle", () => {
    const hook = renderHook(({ latest }) => useHarness(latest), { initialProps: { latest: before } });
    act(() => hook.result.current.freeze.handlers.onPointerEnter(mouse));
    hook.rerender({ latest: after });
    act(() => hook.result.current.freeze.handlers.onPointerLeave(mouse));
    act(() => { vi.advanceTimersByTime(300); });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:a,b,c", "yesterday:d"]);
    // Pointer movement elsewhere restarts the idle wait.
    act(() => { window.dispatchEvent(new Event("pointermove")); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:a,b,c", "yesterday:d"]);
    act(() => { vi.advanceTimersByTime(150); });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:c,a,b", "yesterday:d"]);
  });

  it("holds the order until 600ms after a touch ends, then commits after idle", () => {
    const hook = renderHook(({ latest }) => useHarness(latest), { initialProps: { latest: before } });
    act(() => hook.result.current.freeze.handlers.onTouchStart());
    hook.rerender({ latest: after });
    act(() => hook.result.current.freeze.handlers.onTouchEnd());
    act(() => { vi.advanceTimersByTime(900); });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:a,b,c", "yesterday:d"]);
    act(() => { vi.advanceTimersByTime(150); });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:c,a,b", "yesterday:d"]);
  });

  it("shows a deliberate move at once while hovered", () => {
    const hook = renderHook(({ latest }) => useHarness(latest), { initialProps: { latest: before } });
    act(() => hook.result.current.freeze.handlers.onPointerEnter(mouse));
    act(() => hook.result.current.freeze.allowMoves(1000));
    hook.rerender({ latest: after });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:c,a,b", "yesterday:d"]);
  });

  it("shows the latest order at once when the view changes", () => {
    const hook = renderHook(({ latest, view }) => {
      const freeze = useOrderFreeze();
      return { freeze, layout: useFrozenOrder(latest, freeze.frozen, regroup, view) };
    }, { initialProps: { latest: before, view: "time" } });
    act(() => hook.result.current.freeze.handlers.onPointerEnter(mouse));
    hook.rerender({ latest: after, view: "project" });
    expect(ids(hook.result.current.layout)[1]).toEqual(["today:c,a,b", "yesterday:d"]);
  });
});

describe("freezeLayout", () => {
  it("keeps a row in its old group, drops removed rows and appends new groups", () => {
    const previous = layout([group("today", [row("a"), row("b")]), group("yesterday", [row("c")])]);
    // b moved to a new group, c left the list, x arrived in a brand-new group.
    const latest = layout([group("today", [row("a")]), group("needs", [row("b"), row("x")])]);
    expect(ids(freezeLayout(previous, latest, regroup))).toEqual([[], ["today:a,b", "needs:x"]]);
  });

  it("holds child order and appends new children", () => {
    const previous = layout([group("today", [row("p")])], new Map([["p", [row("k1"), row("k2")]]]));
    const latest = layout([group("today", [row("p")])], new Map([["p", [row("k3"), row("k2"), row("k1")]]]));
    expect(freezeLayout(previous, latest, regroup).children.get("p")!.map((r) => r.id)).toEqual(["k1", "k2", "k3"]);
  });

  it("returns the latest group objects when nothing moved", () => {
    const latest = layout([group("today", [row("a"), row("b")])]);
    const frozen = freezeLayout(layout([group("today", [row("a"), row("b")])]), latest, regroup);
    expect(frozen.regions[1]![0]).toBe(latest.regions[1]![0]);
  });
});
