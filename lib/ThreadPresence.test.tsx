import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginSidebarThread, PluginSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { ThreadPresence } from "./ThreadPresence";

const host = vi.hoisted(() => ({
  context: { threadId: "one" as string | null, projectId: null },
  layout: null as PluginSidebarSplitLayout | null,
  threads: [] as PluginSidebarThread[],
  rpc: { call: vi.fn().mockResolvedValue({ ok: true }) },
  sdk: { threads: { markRead: vi.fn().mockResolvedValue({ ok: true }), timeline: vi.fn(), events: { list: vi.fn().mockResolvedValue([]) } } },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbContext: () => host.context,
  useSidebarSplitLayout: () => host.layout,
  experimental_useSidebarThreads: () => ({ threads: host.threads }),
  useRpc: () => host.rpc,
  useSdk: () => host.sdk,
  UrlLink: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
let focused = true;
let visibility = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  host.context.threadId = "one";
  host.layout = null;
  host.threads = [{ id: "one", latestAttentionAt: 1, isUnread: false }] as PluginSidebarThread[];
  host.rpc.call.mockReset().mockImplementation(async (method: string) => method === "presence_read_point" ? { through: null, messageSeq: null, confirmedAt: null } : { ok: true });
  host.sdk.threads.markRead.mockClear();
  host.sdk.threads.events.list.mockReset().mockResolvedValue([]);
  focused = true;
  visibility = "visible";
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility as DocumentVisibilityState);
});
afterEach(() => { document.querySelectorAll("[data-notification-message]").forEach(el => el.remove()); cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const lastHeartbeat = () => host.rpc.call.mock.calls.filter(([method]) => method === "presence_heartbeat").at(-1)![1];

it("marks read on open and every newer attention event while visible, including when already read", () => {
  const view = render(<ThreadPresence />);
  expect(host.sdk.threads.markRead).toHaveBeenCalledWith({ threadId: "one" });
  expect(lastHeartbeat()).toMatchObject({ threadId: "one", visible: true });
  host.threads = [{ ...host.threads[0]!, latestAttentionAt: 2 }];
  view.rerender(<ThreadPresence />);
  expect(host.sdk.threads.markRead).toHaveBeenCalledTimes(2);
  act(() => { focused = false; window.dispatchEvent(new Event("blur")); });
  expect(lastHeartbeat()).toMatchObject({ threadId: "one", visible: false });
  host.threads = [{ ...host.threads[0]!, latestAttentionAt: 3, isUnread: true }];
  view.rerender(<ThreadPresence />);
  expect(host.sdk.threads.markRead).toHaveBeenCalledTimes(2);
  act(() => { focused = true; window.dispatchEvent(new Event("focus")); });
  expect(host.sdk.threads.markRead).toHaveBeenCalledTimes(3);
});

it("uses only the focused split pane and releases on navigation and unmount", () => {
  host.context.threadId = "two";
  host.layout = { panes: [{ paneId: "p", threadId: "two", isFocused: true, rect: { x: 0, y: 0, width: 1, height: 1 } }] };
  const view = render(<ThreadPresence />);
  expect(lastHeartbeat()).toMatchObject({ threadId: "two", visible: true });
  expect(host.sdk.threads.markRead).toHaveBeenCalledWith({ threadId: "two" });
  host.layout = { panes: [{ ...host.layout.panes[0]!, threadId: null }] };
  view.rerender(<ThreadPresence />);
  expect(lastHeartbeat()).toMatchObject({ threadId: null });
  view.unmount();
  expect(lastHeartbeat()).toMatchObject({ threadId: null, visible: false });
});

it("heartbeats every 20s, stops while hidden, and immediately releases on pagehide", () => {
  render(<ThreadPresence />);
  act(() => { vi.advanceTimersByTime(20_000); });
  expect(host.rpc.call.mock.calls.filter(([method]) => method === "presence_heartbeat")).toHaveLength(2);
  expect(lastHeartbeat().sequence).toBe(2);
  act(() => { visibility = "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
  expect(lastHeartbeat()).toMatchObject({ visible: false });
  const count = host.rpc.call.mock.calls.length;
  act(() => { vi.advanceTimersByTime(40_000); });
  expect(host.rpc.call).toHaveBeenCalledTimes(count);
  act(() => { window.dispatchEvent(new Event("pagehide")); });
  expect(lastHeartbeat()).toMatchObject({ threadId: null, visible: false });
});

it("never marks read in a client that starts hidden or unfocused", () => {
  focused = false;
  render(<ThreadPresence />);
  expect(host.sdk.threads.markRead).not.toHaveBeenCalled();
  expect(lastHeartbeat()).toMatchObject({ visible: false });
});


it("releases a retained split when navigation leaves the displayed thread route", () => {
  host.layout = { panes: [{ paneId: "p", threadId: "one", isFocused: true, rect: { x: 0, y: 0, width: 1, height: 1 } }] };
  const view = render(<ThreadPresence />);
  expect(host.sdk.threads.markRead).toHaveBeenCalledTimes(1);
  host.context.threadId = null;
  view.rerender(<ThreadPresence />);
  expect(lastHeartbeat()).toMatchObject({ threadId: null });
  host.threads = [{ ...host.threads[0]!, latestAttentionAt: 10, isUnread: true }];
  view.rerender(<ThreadPresence />);
  act(() => { vi.advanceTimersByTime(20_000); });
  expect(lastHeartbeat()).toMatchObject({ threadId: null });
  expect(host.sdk.threads.markRead).toHaveBeenCalledTimes(1);
});

it("does not report a retained split whose focused thread differs from the displayed route", () => {
  host.layout = { panes: [{ paneId: "p", threadId: "hidden", isFocused: true, rect: { x: 0, y: 0, width: 1, height: 1 } }] };
  render(<ThreadPresence />);
  expect(lastHeartbeat()).toMatchObject({ threadId: null });
  expect(host.sdk.threads.markRead).not.toHaveBeenCalled();
});


function renderedMessage(seq: number, threadId = "one") {
  const element = document.createElement("div");
  element.dataset.notificationThread = threadId;
  element.dataset.notificationMessage = String(seq);
  document.body.append(element);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ x: 100, y: 100, left: 100, right: 300, top: 100, bottom: 200, width: 200, height: 100, toJSON() {} });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
  return element;
}

it("heartbeats carry the displayed message boundary and never turn later sidebar activity or elapsed time into viewing", async () => {
  const element = renderedMessage(10);
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 10, createdAt: 1000 }]);
  const view = render(<ThreadPresence />);
  await act(async () => {});
  expect(lastHeartbeat()).toMatchObject({ threadId: "one", visible: true, through: 1000, messageSeq: 10 });
  expect(host.sdk.threads.events.list).toHaveBeenCalledWith({ threadId: "one", afterSeq: "9", beforeSeq: "11", order: "asc", limit: "1", signal: expect.any(AbortSignal) });
  host.threads = [{ ...host.threads[0]!, latestAttentionAt: 10000 }];
  view.rerender(<ThreadPresence />);
  await act(async () => { vi.advanceTimersByTime(20_000); });
  expect(lastHeartbeat().through).toBe(1000);
  expect(host.sdk.threads.events.list).toHaveBeenCalledTimes(1);
  element.dataset.notificationMessage = "11";
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 11, createdAt: 10000 }]);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(lastHeartbeat().through).toBe(10000);
});

it("unrendered, occluded and offscreen messages provide no read boundary", async () => {
  host.threads = [{ ...host.threads[0]!, latestAttentionAt: 10000 }];
  render(<ThreadPresence />);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(lastHeartbeat().through).toBeNull();
  const element = renderedMessage(10);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(host.sdk.threads.events.list).not.toHaveBeenCalled();
  vi.mocked(element.getBoundingClientRect).mockReturnValue({ x: 0, y: 10000, left: 0, right: 200, top: 10000, bottom: 10100, width: 200, height: 100, toJSON() {} });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(host.sdk.threads.events.list).not.toHaveBeenCalled();
});

it("a message lookup completing after focus is lost cannot establish a displayed boundary", async () => {
  renderedMessage(10);
  let complete!: (rows: { seq: number; createdAt: number }[]) => void;
  host.sdk.threads.events.list.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  render(<ThreadPresence />);
  await act(async () => {});
  act(() => { focused = false; window.dispatchEvent(new Event("blur")); });
  await act(async () => { complete([{ seq: 10, createdAt: 1000 }]); });
  expect(lastHeartbeat()).toMatchObject({ visible: false, through: null });
  expect(host.rpc.call.mock.calls.some(([method, input]) => method === "presence_heartbeat" && input.through !== null)).toBe(false);
});

it("missing event anchors fail closed and a displayed boundary never crosses thread routes", async () => {
  renderedMessage(10);
  const view = render(<ThreadPresence />);
  await act(async () => {});
  expect(lastHeartbeat().through).toBeNull();
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 10, createdAt: 1000 }]);
  await act(async () => { vi.advanceTimersByTime(1200); });
  expect(lastHeartbeat().through).toBe(1000);
  host.context.threadId = "two";
  view.rerender(<ThreadPresence />);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(lastHeartbeat()).toMatchObject({ threadId: "two", through: null });
});


it("transmits a newly displayed sequence even when its event shares the preceding timestamp", async () => {
  const element = renderedMessage(42);
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 42, createdAt: 1000 }]);
  render(<ThreadPresence />);
  await act(async () => {});
  expect(lastHeartbeat()).toMatchObject({ through: 1000, messageSeq: 42 });
  element.dataset.notificationMessage = "43";
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 43, createdAt: 1000 }]);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(lastHeartbeat()).toMatchObject({ through: 1000, messageSeq: 43 });
});

it.each(["missing", "error"])("backs off %s event lookups and resumes confirmation after recovery", async failure => {
  renderedMessage(42);
  if (failure === "error") host.sdk.threads.events.list.mockRejectedValue(new Error("Unavailable"));
  render(<ThreadPresence />);
  await act(async () => {});
  expect(host.sdk.threads.events.list).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(host.sdk.threads.events.list).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(59_200); });
  expect(host.sdk.threads.events.list).toHaveBeenCalledTimes(6);
  expect(lastHeartbeat().messageSeq).toBeNull();
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 42, createdAt: 1000 }]);
  await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
  expect(lastHeartbeat()).toMatchObject({ through: 1000, messageSeq: 42 });
  const count = host.sdk.threads.events.list.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(host.sdk.threads.events.list).toHaveBeenCalledTimes(count);
});

it("reconfirms the actual displayed message on focus and heartbeat without confirming cached occluded boundaries", async () => {
  const element = renderedMessage(42);
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 42, createdAt: 1000 }]);
  render(<ThreadPresence />);
  await act(async () => {});
  expect(lastHeartbeat()).toMatchObject({ confirmed: true, messageSeq: 42 });
  act(() => { focused = false; window.dispatchEvent(new Event("blur")); });
  expect(lastHeartbeat()).toMatchObject({ confirmed: false });
  act(() => { focused = true; window.dispatchEvent(new Event("focus")); });
  expect(lastHeartbeat()).toMatchObject({ confirmed: true, messageSeq: 42 });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  await act(async () => { vi.advanceTimersByTime(20_000); });
  expect(lastHeartbeat()).toMatchObject({ confirmed: false, messageSeq: 42 });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
  await act(async () => { vi.advanceTimersByTime(20_000); });
  expect(lastHeartbeat()).toMatchObject({ confirmed: true, messageSeq: 42 });
  expect(host.sdk.threads.events.list).toHaveBeenCalledTimes(1);
});

it("confirms viewing an older rendered message without treating the cached newer boundary as visible", async () => {
  const element = renderedMessage(42);
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 42, createdAt: 1000 }]);
  render(<ThreadPresence />);
  await act(async () => {});
  element.dataset.notificationMessage = "41";
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 41, createdAt: 500 }]);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(lastHeartbeat()).toMatchObject({ confirmed: true, messageSeq: 41, through: 500 });
});

it("captures the previous read point before confirming the newest message and clears only at the first unseen anchor", async () => {
  const element = renderedMessage(51);
  host.rpc.call.mockImplementation(async (method: string) => method === "presence_read_point" ? { through: 1000, messageSeq: 42, confirmedAt: null } : { ok: true });
  host.sdk.threads.timeline.mockResolvedValue({ rows: [{ kind: "conversation", messageSeq: 45 }, { kind: "conversation", messageSeq: 51 }], timelinePage: { olderCursor: null } });
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 51, createdAt: 2000 }]);
  const view = render(<ThreadPresence />);
  await act(async () => {});
  expect(view.getByRole("link").getAttribute("href")).toBe("/threads/one#msg=45");
  expect(view.getByText("2 new")).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(1200); });
  expect(lastHeartbeat().messageSeq).toBeNull();
  expect(host.sdk.threads.events.list).not.toHaveBeenCalled();
  element.dataset.notificationMessage = "45";
  host.sdk.threads.events.list.mockResolvedValue([{ seq: 45, createdAt: 1500 }]);
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(view.queryByRole("link")).toBeNull();
  expect(lastHeartbeat()).toMatchObject({ messageSeq: 45, through: 1500 });
});

it("includes older timeline pages and ignores a lookup completing after thread navigation", async () => {
  renderedMessage(99);
  host.rpc.call.mockImplementation(async (method: string) => method === "presence_read_point" ? { through: 1000, messageSeq: 42, confirmedAt: null } : { ok: true });
  host.sdk.threads.timeline.mockResolvedValueOnce({ rows: [{ kind: "conversation", messageSeq: 99 }], timelinePage: { olderCursor: { anchorId: "older", anchorSeq: 60 } } })
    .mockResolvedValueOnce({ rows: [{ kind: "conversation", messageSeq: 45 }], timelinePage: { olderCursor: null } });
  const view = render(<ThreadPresence />);
  await act(async () => {});
  expect(view.getByRole("link").getAttribute("href")).toBe("/threads/one#msg=45");
  expect(view.getByText("2 new")).toBeTruthy();
  expect(host.sdk.threads.timeline).toHaveBeenLastCalledWith(expect.objectContaining({ beforeAnchorId: "older", beforeAnchorSeq: "60" }));
  let finish!: (point: unknown) => void;
  host.rpc.call.mockImplementation(async (method: string) => method === "presence_read_point" ? new Promise(resolve => { finish = resolve; }) : { ok: true });
  host.context.threadId = "two";
  view.rerender(<ThreadPresence />);
  host.context.threadId = null;
  view.rerender(<ThreadPresence />);
  await act(async () => { finish({ messageSeq: 20 }); });
  expect(view.queryByRole("link")).toBeNull();
});
