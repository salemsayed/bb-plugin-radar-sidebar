// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const d of disposers.splice(0)) await d(); vi.restoreAllMocks(); });
const item = { id: "pl_1", bot: "home", text: "Fix the camera", via: "salem", sourceThread: "coord", sourceSeq: 4, state: "open", owner: null, workerThread: null, workerTitle: null,
  lastWord: null, relay: null, followUps: 0, progressAt: "2026-10-07T07:00:00.000Z", createdAt: "2026-10-06T07:00:00.000Z", closedAt: null, evidence: null, nudgedAt: null, askedAt: null };
async function setup(available = true) {
  const callRpc = vi.fn(async ({ pluginId, method, input }: { pluginId: string; method: string; input: any }) => {
    expect(pluginId).toBe("orchestrator-mode");
    if (!available) throw new Error("RPC unavailable");
    if (method === "plate_list") return { items: [item], modes: { home: "on" } };
    if (method === "plate_update") return { item: { ...item, state: "done", closedAt: "2026-10-07T09:00:00.000Z", evidence: input.evidence ?? null } };
    throw new Error(`Unexpected ${method}`);
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: { plugins: { callRpc } } as never });
  await plugin(bb); disposers.push(() => harness.lifecycle.dispose());
  return { callRpc, call: (method: string, input: unknown) => harness.behavior.callRpc(method, input) };
}
it("proxies plate_list and plate_update to the bots plugin", async () => {
  const h = await setup();
  expect(await h.call("crew_plate_list", { bot: "home", states: ["open", "done"] })).toEqual({ items: [item], modes: { home: "on" } });
  expect(h.callRpc).toHaveBeenLastCalledWith(expect.objectContaining({ method: "plate_list", input: { bot: "home", states: ["open", "done"] } }));
  expect(await h.call("crew_plate_update", { id: "pl_1", action: "done", evidence: "Back online" })).toMatchObject({ item: { state: "done", evidence: "Back online" } });
  expect(h.callRpc).toHaveBeenLastCalledWith(expect.objectContaining({ method: "plate_update", input: { id: "pl_1", action: "done", evidence: "Back online" } }));
});
it("reads an unavailable plate as no items", async () => {
  const h = await setup(false);
  expect(await h.call("crew_plate_list", {})).toEqual({ items: null, modes: {} });
});
