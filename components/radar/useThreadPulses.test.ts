// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread } from "./fixtures";

const sdk = {
  threads: {
    output: vi.fn(async ({ threadId }: { threadId: string }) => ({ output: `Subject: ${threadId}\n\nDone.` })),
    context: vi.fn(async () => ({ usage: { snapshot: { usedTokens: 10, contextWindowTokens: 100 } } })),
  },
};
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@get-bb/plugin-sdk/app")>(),
  useSdk: () => sdk,
}));
const { useThreadPulses } = await import("./useThreadPulses");

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("thread pulses", () => {
  it("reads a settled reply once, ignores a mark-read, and rereads on a new reply", async () => {
    const root = makeThread({ id: "root", latestAttentionAt: 100, updatedAt: 100, isUnread: true });
    const { result, rerender } = renderHook(({ threads }) => useThreadPulses(threads, true), { initialProps: { threads: [root] } });
    await waitFor(() => expect(result.current.get("root")?.subject).toContain("root"));
    expect(sdk.threads.output).toHaveBeenCalledTimes(1);
    // Mark-read touches updatedAt only.
    rerender({ threads: [{ ...root, isUnread: false, lastReadAt: 150, updatedAt: 150 }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sdk.threads.output).toHaveBeenCalledTimes(1);
    expect(sdk.threads.context).toHaveBeenCalledTimes(1);
    // A reply moves latestAttentionAt.
    rerender({ threads: [{ ...root, latestAttentionAt: 200, updatedAt: 200 }] });
    await waitFor(() => expect(sdk.threads.output).toHaveBeenCalledTimes(2));
    expect(result.current.get("root")?.context).toBe(0.1);
  });
  it("refetches once a live coordinator settles", async () => {
    const live = makeThread({ id: "root", status: "active", latestAttentionAt: 100, updatedAt: 100 });
    const { rerender } = renderHook(({ threads }) => useThreadPulses(threads, true), { initialProps: { threads: [live] } });
    await waitFor(() => expect(sdk.threads.context).toHaveBeenCalledTimes(1));
    expect(sdk.threads.output).not.toHaveBeenCalled();
    rerender({ threads: [{ ...live, status: "idle", latestAttentionAt: 100 }] });
    await waitFor(() => expect(sdk.threads.output).toHaveBeenCalledTimes(1));
  });
});
