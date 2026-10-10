// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread } from "./fixtures";

const asked: { threadId: string; version: number }[][] = [];
let dismissed = false;
const rpc = {
  call: vi.fn(async (method: string, input: { threads: { threadId: string; version: number }[] }) => {
    expect(method).toBe("crew_asks");
    asked.push(input.threads);
    return { judgements: input.threads.map(({ threadId, version }) => ({ threadId, version, waiting: 0.9, ask: `${threadId}?`, itemId: "n1", dismissed })) };
  }),
};
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@get-bb/plugin-sdk/app")>(),
  useRpc: () => rpc,
}));
const { useCrewJudgements } = await import("./useCrewData");
const { needsChanged } = await import("@/lib/needsClient");

afterEach(() => { cleanup(); vi.clearAllMocks(); asked.length = 0; dismissed = false; });

describe("crew judgements", () => {
  it("asks again when the Needs You list changes elsewhere, such as ChatGPT closing an ask", async () => {
    const coord = makeThread({ id: "coord", latestAttentionAt: 100 });
    const { rerender } = renderHook(({ key }) => useCrewJudgements([coord], key), { initialProps: { key: "n1:open" } });
    await waitFor(() => expect(asked).toHaveLength(1));
    rerender({ key: "n1:open" });
    rerender({ key: "n1:done" });
    await waitFor(() => expect(asked).toHaveLength(2));
  });
  it("judges a working or queued coordinator too, so closing its ask clears it", async () => {
    const coord = makeThread({ id: "coord", latestAttentionAt: 100 });
    const { result, rerender } = renderHook(({ threads, key }) => useCrewJudgements(threads, key), { initialProps: { threads: [coord], key: "n1:open" } });
    await waitFor(() => expect(result.current.get("coord")?.ask).toBe("coord?"));
    // Starting work alone asks nothing new.
    rerender({ threads: [{ ...coord, status: "active", queuedWork: "waiting" }], key: "n1:open" });
    expect(asked).toHaveLength(1);
    // The ask closed while the bot is busy: asked again, the bot included.
    rerender({ threads: [{ ...coord, status: "active", queuedWork: "waiting" }], key: "n1:done" });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toEqual([{ threadId: "coord", version: 100 }]);
    // Settled on a new reply: asked again and replaced.
    rerender({ threads: [{ ...coord, latestAttentionAt: 200 }], key: "n1:done" });
    await waitFor(() => expect(result.current.get("coord")?.version).toBe(200));
  });
  it("asks again after a Needs You change so Done reaches the bubble", async () => {
    const coord = makeThread({ id: "coord", latestAttentionAt: 100 });
    const { result } = renderHook(() => useCrewJudgements([coord]));
    await waitFor(() => expect(result.current.get("coord")?.dismissed).toBe(false));
    dismissed = true;
    act(() => needsChanged());
    await waitFor(() => expect(result.current.get("coord")?.dismissed).toBe(true));
    expect(asked).toHaveLength(2);
  });
});
