// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPresenceServer, registerPresence } from "./presenceServer";
import { LEASE_MS } from "./presence";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  let now = 1;
  const presence = createPresenceServer(() => now);
  return { presence, advance: (ms: number) => { now += ms; }, heartbeat: (clientId = "one", sequence = 1, visible = true, threadId: string | null = "thread") => presence.heartbeat({ clientId, sequence, visible, threadId }) };
}

it("holds presence across clients until the last lease expires", () => {
  const f = fixture();
  f.heartbeat();
  f.advance(20_000);
  f.heartbeat("two");
  f.heartbeat("one", 2, false);
  f.advance(LEASE_MS - 1);
  expect(f.presence.open("thread")).toBe(true);
  f.advance(1);
  expect(f.presence.open("thread")).toBe(false);
});

it("ignores an older open arriving after close and renews only newer heartbeats", () => {
  const f = fixture();
  f.heartbeat("one", 2, false);
  f.heartbeat("one", 1);
  expect(f.presence.open("thread")).toBe(false);
  f.heartbeat("one", 3);
  f.advance(40_000);
  f.heartbeat("one", 4);
  f.advance(40_000);
  expect(f.presence.open("thread")).toBe(true);
});

it("switching, closing, and disposal release presence without any notification settings", () => {
  const f = fixture();
  f.heartbeat();
  f.heartbeat("one", 2, true, "next");
  expect(f.presence.open("thread")).toBe(false);
  expect(f.presence.open("next")).toBe(true);
  f.heartbeat("one", 3, true, null);
  expect(f.presence.open("next")).toBe(false);
  f.heartbeat("one", 4);
  f.presence.dispose();
  f.heartbeat("one", 5);
  expect(f.presence.open("thread")).toBe(false);
});

it("wall-clock changes cannot extend leases using the production monotonic clock", () => {
  let elapsed = 100;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const wall = vi.spyOn(Date, "now").mockReturnValue(10_000_000);
  const p = createPresenceServer();
  p.heartbeat({ clientId: "one", sequence: 1, visible: true, threadId: "thread" });
  wall.mockReturnValue(1);
  elapsed += LEASE_MS + 1;
  expect(p.open("thread")).toBe(false);
});

it("restart starts empty and the RPC lifecycle never touches storage or another plugin", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  const storage = vi.spyOn(bb.storage, "database");
  try {
    await registerPresence(bb);
    await harness.behavior.callRpc("presence_heartbeat", { clientId: "one", sequence: 1, visible: true, threadId: "thread" });
    expect(await harness.behavior.callRpc("presence_open", { threadId: "thread" })).toEqual({ open: true });
    expect(createPresenceServer().open("thread")).toBe(false);
    expect(storage).not.toHaveBeenCalled();
    expect(harness.inspection.sdk.calls).toEqual([]);
  } finally { await harness.lifecycle.dispose(); }
});
