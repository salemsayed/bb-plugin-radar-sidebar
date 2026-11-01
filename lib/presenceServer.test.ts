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

it("restart restores confirmed boundaries while leases start empty and no other plugin is called", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  try {
    await registerPresence(bb);
    await harness.behavior.callRpc("presence_heartbeat", { clientId: "one", sequence: 1, visible: true, threadId: "thread", through: 1000 });
    expect(await harness.behavior.callRpc("presence_open", { threadId: "thread" })).toEqual({ open: true });
    expect(createPresenceServer().open("thread")).toBe(false);
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000 });
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "unknown" })).toEqual({ through: null });
    const next = await harness.lifecycle.reload(registerPresence);
    expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000 });
    expect(await next.harness.behavior.callRpc("presence_open", { threadId: "thread" })).toEqual({ open: false });
    await next.harness.lifecycle.dispose();
    expect(harness.inspection.sdk.calls).toEqual([]);
  } finally { await harness.lifecycle.dispose(); }
});


it("a lost close leaves the lease open but never moves the confirmed display boundary", () => {
  let now = 1000;
  const presence = createPresenceServer(() => now);
  presence.heartbeat({ clientId: "one", sequence: 1, visible: true, threadId: "thread", through: 1000 });
  now = 15000;
  expect(presence.open("thread")).toBe(true);
  expect(presence.readPoint("thread")).toBe(1000);
  presence.heartbeat({ clientId: "one", sequence: 2, visible: true, threadId: "thread" });
  expect(presence.readPoint("thread")).toBe(1000);
  now += LEASE_MS * 3; presence.sweep();
  expect(presence.open("thread")).toBe(false);
  expect(presence.readPoint("thread")).toBe(1000);
});

it("only newer visible heartbeats with a boundary advance the per-thread maximum", () => {
  const p = createPresenceServer();
  p.heartbeat({ clientId: "one", sequence: 2, visible: true, threadId: "thread", through: 1000 });
  p.heartbeat({ clientId: "one", sequence: 1, visible: true, threadId: "thread", through: 10000 });
  p.heartbeat({ clientId: "one", sequence: 3, visible: false, threadId: "thread", through: 10000 });
  p.heartbeat({ clientId: "two", sequence: 1, visible: true, threadId: "thread", through: 500 });
  p.heartbeat({ clientId: "one", sequence: 4, visible: true, threadId: null, through: 10000 });
  expect(p.readPoint("thread")).toBe(1000);
  p.heartbeat({ clientId: "two", sequence: 2, visible: true, threadId: "thread", through: 2000 });
  expect(p.readPoint("thread")).toBe(2000);
  expect(p.readPoint("unseen")).toBeNull();
});
