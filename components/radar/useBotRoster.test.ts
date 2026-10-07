// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterBot } from "./bots";

const bot: RosterBot = { key: "personal", name: "Personal Bot", current: "root", projectId: "a", projects: [], hostId: "h", providerId: "pi", model: "m", rollover: null };
const callRpc = vi.fn<() => Promise<{ bots: RosterBot[] }>>();
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@get-bb/plugin-sdk/app")>(),
  useSdk: () => ({ plugins: { callRpc } }),
}));
const { useBotRoster, isPluginAbsentError } = await import("./useBotRoster");

const CACHE_KEY = "radar.botRoster.v1";
beforeEach(() => { localStorage.setItem(CACHE_KEY, JSON.stringify({ bots: [bot] })); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); localStorage.clear(); });

describe("bot roster cache", () => {
  it("keeps the cached roster through transient failures and drops it after three in a row", async () => {
    vi.useFakeTimers();
    callRpc.mockRejectedValue(new Error("fetch failed"));
    const { result } = renderHook(() => useBotRoster(true));
    expect(result.current).toEqual([bot]);
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toEqual([bot]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current).toEqual([bot]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(callRpc.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current).toEqual([]);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    // A later success restores the roster and the cache.
    callRpc.mockResolvedValue({ bots: [bot] });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current).toEqual([bot]);
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
  });
  it("drops the cached roster at once when the plugin is absent", async () => {
    callRpc.mockRejectedValue(new Error('HTTP 404: unknown plugin "orchestrator-mode"'));
    const { result } = renderHook(() => useBotRoster(true));
    expect(result.current).toEqual([bot]);
    await waitFor(() => expect(result.current).toEqual([]));
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
  it("recognises the server's absent-plugin messages only", () => {
    expect(isPluginAbsentError(new Error('HTTP 404: unknown plugin "x"'))).toBe(true);
    expect(isPluginAbsentError(new Error('HTTP 404: plugin "x" has no rpc method "bot_roster"'))).toBe(true);
    expect(isPluginAbsentError(new Error("HTTP 500: boom"))).toBe(false);
    expect(isPluginAbsentError(new TypeError("Failed to fetch"))).toBe(false);
  });
});
