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
  it("keeps a coordinator's judgement while a message is queued or it is running", async () => {
    const coord = makeThread({ id: "coord", latestAttentionAt: 100 });
    const other = makeThread({ id: "other", latestAttentionAt: 50 });
    const { result, rerender } = renderHook(({ threads }) => useCrewJudgements(threads), { initialProps: { threads: [coord, other] } });
    await waitFor(() => expect(result.current.get("coord")?.ask).toBe("coord?"));
    expect(asked).toEqual([[{ threadId: "coord", version: 100 }, { threadId: "other", version: 50 }]]);
    // Queued: left out of the request, still judged.
    rerender({ threads: [{ ...coord, queuedWork: "waiting" }, other] });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1]).toEqual([{ threadId: "other", version: 50 }]);
    expect(result.current.get("coord")).toMatchObject({ version: 100, ask: "coord?" });
    rerender({ threads: [{ ...coord, status: "active" }, other] });
    expect(result.current.get("coord")).toMatchObject({ version: 100, ask: "coord?" });
    // Settled on a new reply: asked again and replaced.
    rerender({ threads: [{ ...coord, latestAttentionAt: 200 }, other] });
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
