// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeListedThread } from "./fixtures";
import { useThreadCensus, type ListedThread } from "./hiddenThreads";
const { sdk } = vi.hoisted(() => ({ sdk: { threads: { list: vi.fn() } } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const worker = makeListedThread({ id: "worker", projectId: "a", lifecycleOwnerThreadId: "root", status: "active" });
const fullPage = () => [worker, ...Array.from({ length: 199 }, (_, i) => makeListedThread({ id: `filler-${i}`, projectId: "a" }))];
function pending() {
  let resolve!: (rows: ListedThread[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ListedThread[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("incremental census lifecycle", () => {
  it("publishes first and second page lower bounds, deduplicates and completes", async () => {
    const second = pending(), third = pending();
    sdk.threads.list.mockImplementation(({ offset }) => offset === 0 ? Promise.resolve(fullPage()) : offset === 200 ? second.promise : third.promise);
    const { result } = renderHook(() => useThreadCensus(true, ["a", "a"], 0));
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    expect(result.current.complete).toBe(false);
    await act(async () => second.resolve([worker, ...Array.from({ length: 199 }, (_, i) => makeListedThread({ id: `next-${i}`, projectId: "a" }))]));
    expect(result.current.rows).toHaveLength(399);
    expect(result.current.complete).toBe(false);
    await act(async () => third.resolve([]));
    expect(result.current.complete).toBe(true);
    expect(result.current.rows.filter(row => row.id === worker.id)).toHaveLength(1);
  });
  it("preserves successful pages on error, retries from scratch, and clears stale work on complete zero", async () => {
    let phase = 0;
    sdk.threads.list.mockImplementation(({ offset }) => phase === 0 ? offset === 0 ? Promise.resolve(fullPage()) : Promise.reject(new Error("page two")) : Promise.resolve([]));
    const { result } = renderHook(() => useThreadCensus(true, ["a"], 0));
    await waitFor(() => expect(sdk.threads.list).toHaveBeenCalledTimes(2));
    expect(result.current.rows).toHaveLength(200); expect(result.current.complete).toBe(false);
    phase = 1; fireEvent(window, new Event("focus"));
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.rows).toEqual([]); expect(result.current.staleRows).toEqual([]);
  });
  it("does not accumulate duplicates across failed refreshes or retain old active status after idle recovery", async () => {
    let phase = 0;
    sdk.threads.list.mockImplementation(() => phase === 1 ? Promise.reject(new Error("offline")) : Promise.resolve([{ ...worker, status: phase === 2 ? "idle" : "active" }]));
    const { result } = renderHook(() => useThreadCensus(true, ["a"], 0));
    await waitFor(() => expect(result.current.complete).toBe(true));
    phase = 1;
    for (let i = 0; i < 3; i++) { fireEvent(window, new Event("focus")); await waitFor(() => expect(result.current.staleRows).toHaveLength(1)); }
    expect(result.current.rows).toEqual([]);
    phase = 2; fireEvent(window, new Event("focus"));
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.rows[0]?.status).toBe("idle"); expect(result.current.staleRows).toEqual([]);
  });
  it("clears old scope immediately, ignores cancelled pages, and fetches anew on return", async () => {
    const delayed = pending(); let returned = false;
    sdk.threads.list.mockImplementation(({ projectId, offset }) => projectId === "b" || returned ? Promise.resolve([]) : offset === 0 ? Promise.resolve(fullPage()) : delayed.promise);
    const { result, rerender } = renderHook(({ ids }) => useThreadCensus(true, ids, 0), { initialProps: { ids: ["a"] } });
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    const oldSignal = sdk.threads.list.mock.calls[1]![0].signal as AbortSignal;
    rerender({ ids: ["b"] });
    expect(result.current.rows).toEqual([]); expect(result.current.staleRows).toEqual([]);
    expect(oldSignal.aborted).toBe(true);
    await act(async () => delayed.resolve([worker]));
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.rows).toEqual([]);
    returned = true; rerender({ ids: ["a"] });
    expect(result.current.rows).toEqual([]); expect(result.current.staleRows).toEqual([]);
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.rows).toEqual([]);
  });
  it("cancels a superseded refresh so late activity cannot replace recovered zero", async () => {
    const late = pending(); let refresh = false;
    sdk.threads.list.mockImplementation(({ offset }) => refresh ? Promise.resolve([]) : offset === 0 ? Promise.resolve(fullPage()) : late.promise);
    const { result } = renderHook(() => useThreadCensus(true, ["a"], 0));
    await waitFor(() => expect(result.current.rows).toHaveLength(200));
    refresh = true; fireEvent(window, new Event("focus"));
    await waitFor(() => expect(result.current.complete).toBe(true));
    await act(async () => late.resolve([worker]));
    expect(result.current.rows).toEqual([]); expect(result.current.staleRows).toEqual([]);
  });
  it("aborts pending work on unmount", async () => {
    const late = pending(); sdk.threads.list.mockReturnValue(late.promise);
    const { unmount } = renderHook(() => useThreadCensus(true, ["a"], 0));
    const signal = sdk.threads.list.mock.calls[0]![0].signal as AbortSignal;
    unmount(); expect(signal.aborted).toBe(true);
    await act(async () => late.resolve([worker]));
  });
  it("keeps a pending first page unknown and stops safely when servers repeat pages", async () => {
    const first = pending(); sdk.threads.list.mockReturnValue(first.promise);
    const { result } = renderHook(() => useThreadCensus(true, ["a"], 0));
    expect(result.current.complete).toBe(false); expect(result.current.rows).toEqual([]);
    await act(async () => first.resolve(fullPage()));
    await waitFor(() => expect(sdk.threads.list).toHaveBeenCalledTimes(2));
    expect(result.current.rows).toHaveLength(200); expect(result.current.complete).toBe(false);
  });
});
