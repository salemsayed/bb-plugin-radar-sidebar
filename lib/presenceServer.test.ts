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
    await harness.behavior.callRpc("presence_heartbeat", { clientId: "one", sequence: 1, visible: true, threadId: "thread", through: 1000, messageSeq: 42 });
    expect(await harness.behavior.callRpc("presence_open", { threadId: "thread" })).toEqual({ open: true });
    expect(createPresenceServer().open("thread")).toBe(false);
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: null });
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "unknown" })).toEqual({ through: null, messageSeq: null, confirmedAt: null });
    const next = await harness.lifecycle.reload(registerPresence);
    expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: null });
    expect(await next.harness.behavior.callRpc("presence_open", { threadId: "thread" })).toEqual({ open: false });
    await next.harness.lifecycle.dispose();
    expect(harness.inspection.sdk.calls).toEqual([]);
  } finally { await harness.lifecycle.dispose(); }
});


it("a lost close leaves the lease open but never moves the confirmed display boundary", () => {
  let now = 1000;
  const presence = createPresenceServer(() => now);
  presence.heartbeat({ clientId: "one", sequence: 1, visible: true, threadId: "thread", through: 1000, messageSeq: 42 });
  now = 15000;
  expect(presence.open("thread")).toBe(true);
  expect(presence.readPoint("thread")).toEqual({ through: 1000, messageSeq: 42 });
  presence.heartbeat({ clientId: "one", sequence: 2, visible: true, threadId: "thread" });
  expect(presence.readPoint("thread")).toEqual({ through: 1000, messageSeq: 42 });
  now += LEASE_MS * 3; presence.sweep();
  expect(presence.open("thread")).toBe(false);
  expect(presence.readPoint("thread")).toEqual({ through: 1000, messageSeq: 42 });
});

it("only newer visible heartbeats with a boundary advance the per-thread maximum", () => {
  const p = createPresenceServer();
  p.heartbeat({ clientId: "one", sequence: 2, visible: true, threadId: "thread", through: 1000, messageSeq: 42 });
  p.heartbeat({ clientId: "one", sequence: 1, visible: true, threadId: "thread", through: 10000, messageSeq: 43 });
  p.heartbeat({ clientId: "one", sequence: 3, visible: false, threadId: "thread", through: 10000, messageSeq: 43 });
  p.heartbeat({ clientId: "two", sequence: 1, visible: true, threadId: "thread", through: 500, messageSeq: 41 });
  p.heartbeat({ clientId: "one", sequence: 4, visible: true, threadId: null, through: 10000, messageSeq: 43 });
  expect(p.readPoint("thread")).toEqual({ through: 1000, messageSeq: 42 });
  p.heartbeat({ clientId: "two", sequence: 2, visible: true, threadId: "thread", through: 2000, messageSeq: 43 });
  expect(p.readPoint("thread")).toEqual({ through: 2000, messageSeq: 43 });
  expect(p.readPoint("unseen")).toBeNull();
});


it("equal-timestamp message boundaries persist their sequence and ignore timestamp-only heartbeats", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  bb.storage.database().exec("CREATE TABLE presence_read_points(thread_id TEXT PRIMARY KEY,through INTEGER NOT NULL); INSERT INTO presence_read_points VALUES('thread',99999)");
  try {
    await registerPresence(bb);
    await harness.behavior.callRpc("presence_heartbeat", { clientId: "client", sequence: 1, threadId: "thread", visible: true, through: 1000 });
    expect(await harness.behavior.callRpc("presence_open", { threadId: "thread" })).toEqual({ open: true });
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: null, messageSeq: null, confirmedAt: null });
    await harness.behavior.callRpc("presence_heartbeat", { clientId: "client", sequence: 2, threadId: "thread", visible: true, through: 1000, messageSeq: 42 });
    const next = await harness.lifecycle.reload(registerPresence);
    try {
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: null });
      await next.harness.behavior.callRpc("presence_heartbeat", { clientId: "client", sequence: 3, threadId: "thread", visible: true, through: 1000, messageSeq: 43 });
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000, messageSeq: 43, confirmedAt: null });
      await next.harness.behavior.callRpc("presence_heartbeat", { clientId: "client", sequence: 4, threadId: "thread", visible: true, through: 99999, messageSeq: 42 });
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "thread" })).toEqual({ through: 1000, messageSeq: 43, confirmedAt: null });
    } finally { await next.harness.lifecycle.dispose(); }
  } finally { await harness.lifecycle.dispose(); }
});

it("keeps sequence and timestamp from the same observation instead of combining maxima", () => {
  const p = createPresenceServer();
  p.heartbeat({ clientId: "one", sequence: 1, threadId: "thread", visible: true, through: 2000, messageSeq: 42 });
  p.heartbeat({ clientId: "two", sequence: 1, threadId: "thread", visible: true, through: 1000, messageSeq: 43 });
  expect(p.readPoint("thread")).toEqual({ through: 1000, messageSeq: 43 });
});

it("timestamps only fresh visible confirmations and never upgrades saved points or cached heartbeats", () => {
  let wall = 1500;
  const p = createPresenceServer(() => wall, new Map(), new Map(), () => wall);
  const boundary = { clientId: "client", threadId: "replacement", visible: true, through: 1000, messageSeq: 42 };
  p.heartbeat({ ...boundary, sequence: 1, confirmed: true });
  expect(p.confirmedAt("replacement")).toBe(1500);
  wall = 1800;
  p.heartbeat({ ...boundary, sequence: 2, visible: false });
  wall = 2500;
  p.heartbeat({ ...boundary, sequence: 3 });
  expect(p.confirmedAt("replacement")).toBe(1500);
  p.heartbeat({ ...boundary, sequence: 2, confirmed: true });
  p.heartbeat({ ...boundary, sequence: 4, confirmed: true, visible: false });
  p.heartbeat({ ...boundary, sequence: 5, confirmed: true, messageSeq: undefined });
  expect(p.confirmedAt("replacement")).toBe(1500);
  p.heartbeat({ ...boundary, sequence: 6, confirmed: true });
  expect(p.confirmedAt("replacement")).toBe(2500);
  expect(p.readPoint("replacement")).toEqual({ through: 1000, messageSeq: 42 });
  wall += LEASE_MS * 3;
  p.sweep();
  expect(p.open("replacement")).toBe(false);
  expect(p.confirmedAt("replacement")).toBe(2500);
});

it("persists server receipt time across reload and renews it for the same or an older displayed message", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  const wall = vi.spyOn(Date, "now").mockReturnValue(1500);
  try {
    await registerPresence(bb);
    const boundary = { clientId: "client", threadId: "replacement", visible: true, through: 1000, messageSeq: 42 };
    await harness.behavior.callRpc("presence_heartbeat", { ...boundary, sequence: 1 });
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: null });
    await harness.behavior.callRpc("presence_heartbeat", { ...boundary, sequence: 2, confirmed: true });
    const next = await harness.lifecycle.reload(registerPresence);
    try {
      wall.mockReturnValue(2500);
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 1500 });
      await next.harness.behavior.callRpc("presence_heartbeat", { ...boundary, sequence: 3, confirmed: true, through: 500, messageSeq: 41 });
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 2500 });
    } finally { await next.harness.lifecycle.dispose(); }
  } finally { await harness.lifecycle.dispose(); }
});

it("rejects replay after lease cleanup without renewing confirmation or restoring presence", async () => {
  vi.useFakeTimers();
  let elapsed = 0;
  vi.spyOn(performance, "now").mockImplementation(() => elapsed);
  const wall = vi.spyOn(Date, "now").mockReturnValue(1500);
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  try {
    await registerPresence(bb);
    const packet = { clientId: "client", sequence: 1, threadId: "replacement", visible: true, through: 1000, messageSeq: 42, confirmed: true };
    await harness.behavior.callRpc("presence_heartbeat", packet);
    wall.mockReturnValue(1600); elapsed = 100;
    await harness.behavior.callRpc("presence_heartbeat", { ...packet, sequence: 2, visible: false });
    elapsed = LEASE_MS * 3;
    await vi.advanceTimersByTimeAsync(5000);
    wall.mockReturnValue(2500);
    await harness.behavior.callRpc("presence_heartbeat", packet);
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 1500 });
    expect(await harness.behavior.callRpc("presence_open", { threadId: "replacement" })).toEqual({ open: false });
    expect(bb.storage.database().prepare("SELECT sequence FROM presence_client_sequences WHERE client_id='client'").get()).toEqual({ sequence: 2 });
    wall.mockReturnValue(2600);
    await harness.behavior.callRpc("presence_heartbeat", { ...packet, sequence: 3 });
    expect(await harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 2600 });
    expect(await harness.behavior.callRpc("presence_open", { threadId: "replacement" })).toEqual({ open: true });
  } finally { await harness.lifecycle.dispose(); vi.useRealTimers(); }
});

it("rejects replay across plugin reload and keeps each client's durable sequence independent", async () => {
  const wall = vi.spyOn(Date, "now").mockReturnValue(1500);
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  try {
    await registerPresence(bb);
    const packet = { clientId: "client", sequence: 1, threadId: "replacement", visible: true, through: 1000, messageSeq: 42, confirmed: true };
    await harness.behavior.callRpc("presence_heartbeat", packet);
    wall.mockReturnValue(1600);
    await harness.behavior.callRpc("presence_heartbeat", { ...packet, sequence: 2, visible: false });
    const next = await harness.lifecycle.reload(registerPresence);
    try {
      wall.mockReturnValue(2500);
      for (const sequence of [1, 2]) await next.harness.behavior.callRpc("presence_heartbeat", { ...packet, sequence });
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 1500 });
      expect(await next.harness.behavior.callRpc("presence_open", { threadId: "replacement" })).toEqual({ open: false });
      expect(next.bb.storage.database().prepare("SELECT sequence FROM presence_client_sequences WHERE client_id='client'").get()).toEqual({ sequence: 2 });
      wall.mockReturnValue(2600);
      await next.harness.behavior.callRpc("presence_heartbeat", { ...packet, clientId: "other-client" });
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 2600 });
      wall.mockReturnValue(2700);
      await next.harness.behavior.callRpc("presence_heartbeat", { ...packet, sequence: 3 });
      expect(await next.harness.behavior.callRpc("presence_read_point", { threadId: "replacement" })).toEqual({ through: 1000, messageSeq: 42, confirmedAt: 2700 });
    } finally { await next.harness.lifecycle.dispose(); }
  } finally { await harness.lifecycle.dispose(); }
});
