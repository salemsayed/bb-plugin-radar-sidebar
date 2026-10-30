// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { botTasksSchema } from "@/lib/botTasks";
import { BOT_SEEDS, makeBot, makeOutput, makeTask } from "./botTasksFixtures";
import { useDispatchWorkers } from "./useDispatchWorkers";
const { sdk } = vi.hoisted(() => ({ sdk: { plugins: { callRpc: vi.fn() }, threads: { list: vi.fn() } } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
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
