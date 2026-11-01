// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { botTasksSchema } from "@/lib/botTasks";
import { BOT_SEEDS, makeBot, makeOutput, makeTask } from "./botTasksFixtures";
import { COORDINATOR_REFRESH_MS, resetWorkerSnapshotCache, useDispatchWorkers } from "./useDispatchWorkers";
const { sdk } = vi.hoisted(() => ({ sdk: { plugins: { callRpc: vi.fn() }, threads: { list: vi.fn() } } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk }));
afterEach(() => { cleanup(); vi.resetAllMocks(); resetWorkerSnapshotCache(); });
const data = () => botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0], [makeTask("erbareeq", "One task", "working", { id: "one" }), makeTask("erbareeq", "Second task", "working", { id: "two" })])]));
it("counts distinct running worker attempts, excluding ended attempts and the coordinator", async () => {
  sdk.plugins.callRpc.mockResolvedValue({ workers: [{ threadId: "a", model: "Opus", state: "running" }, { threadId: "b", model: "Sol", state: "idle" }, { threadId: "thr_coord_erbareeq", state: "running" }] });
  sdk.threads.list.mockResolvedValue([{ id: "a", status: "active", createdAt: 100 }, { id: "b", status: "idle" }, { id: "thr_coord_erbareeq", status: "active" }]);
  const { result } = renderHook(() => useDispatchWorkers(dataValue));
  await waitFor(() => expect(result.current.known.has("erbareeq")).toBe(true));
  expect(result.current.byBot.erbareeq).toHaveLength(1);
  expect(result.current.byBot.erbareeq[0].model).toBe("Opus");
});
const dataValue = data();
it("does not substitute a conversation or task count for missing attempts", async () => {
  sdk.plugins.callRpc.mockRejectedValue(new Error("missing"));
  const { result } = renderHook(() => useDispatchWorkers(dataValue));
  await waitFor(() => expect(result.current.byBot.erbareeq).toEqual([]));
  expect(result.current.known.has("erbareeq")).toBe(false);
});
it("includes actual unlinked workers and avoids double counting", async () => {
  const value = data(); value.bots[0].unlinked = [{ threadId: "a", title: "Unlinked" }];
  sdk.plugins.callRpc.mockResolvedValue({ workers: [{ threadId: "a", model: "Sol", state: "running" }] });
  sdk.threads.list.mockResolvedValue([{ id: "a", status: "active", createdAt: 100 }]);
  const { result } = renderHook(() => useDispatchWorkers(value));
  await waitFor(() => expect(result.current.known.has("erbareeq")).toBe(true));
  expect(result.current.byBot.erbareeq).toHaveLength(1);
});
it("reads each bot's coordinator status into chat, never as a worker", async () => {
  const value = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0], []), makeBot(BOT_SEEDS[3], [])]));
  sdk.threads.list.mockResolvedValue([{ id: "thr_coord_erbareeq", status: "active", createdAt: 100 }, { id: "thr_coord_home", status: "idle", createdAt: 100 }]);
  const { result } = renderHook(() => useDispatchWorkers(value));
  await waitFor(() => expect(result.current.known.has("erbareeq")).toBe(true));
  expect([...result.current.chat]).toEqual(["erbareeq"]);
  expect(result.current.byBot.erbareeq).toEqual([]);
  expect(sdk.threads.list).toHaveBeenCalledWith({ threadIds: ["thr_coord_erbareeq", "thr_coord_home"], includeHidden: true });
});
it("refreshes coordinator status between task reloads", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const value = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0], [])]));
  sdk.threads.list.mockResolvedValue([{ id: "thr_coord_erbareeq", status: "idle", createdAt: 100 }]);
  const { result } = renderHook(() => useDispatchWorkers(value));
  await waitFor(() => expect(result.current.known.has("erbareeq")).toBe(true));
  expect(result.current.chat.size).toBe(0);
  sdk.threads.list.mockResolvedValue([{ id: "thr_coord_erbareeq", status: "active", createdAt: 100 }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(COORDINATOR_REFRESH_MS); });
  expect(result.current.chat.has("erbareeq")).toBe(true);
  vi.useRealTimers();
});
it("shows the last known worker counts at once when the board mounts again, then replaces them", async () => {
  sdk.plugins.callRpc.mockResolvedValue({ workers: [{ threadId: "a", model: "Opus", state: "running" }] });
  sdk.threads.list.mockResolvedValue([{ id: "a", status: "active", createdAt: 100 }]);
  const first = renderHook(() => useDispatchWorkers(dataValue));
  await waitFor(() => expect(first.result.current.known.has("erbareeq")).toBe(true));
  first.unmount();
  let release: (value: unknown) => void = () => {};
  sdk.plugins.callRpc.mockReturnValue(new Promise(resolve => { release = resolve; }));
  const second = renderHook(() => useDispatchWorkers(dataValue));
  expect(second.result.current.known.has("erbareeq")).toBe(true);
  expect(second.result.current.byBot.erbareeq).toHaveLength(1);
  sdk.threads.list.mockResolvedValue([]);
  await act(async () => { release({ workers: [] }); });
  await waitFor(() => expect(second.result.current.byBot.erbareeq).toEqual([]));
  second.unmount();
  const third = renderHook(() => useDispatchWorkers(dataValue));
  expect(third.result.current.byBot.erbareeq).toEqual([]);
});
