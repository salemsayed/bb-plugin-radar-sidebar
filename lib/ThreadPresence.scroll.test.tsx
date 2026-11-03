import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThreadPresence } from "./ThreadPresence";

const host = vi.hoisted(() => ({
  enabled: true,
  navigate: { openUrl: vi.fn() },
  rpc: { call: vi.fn() },
  sdk: { threads: { markRead: vi.fn().mockResolvedValue({ ok: true }), events: { list: vi.fn().mockResolvedValue([]) } } },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSettings: () => ({ values: { rememberScroll: host.enabled } }),
  useBbNavigate: () => host.navigate,
  useBbContext: () => ({ threadId: "one" }),
  useSidebarSplitLayout: () => null,
  experimental_useSidebarThreads: () => ({ threads: [] }),
  useRpc: () => host.rpc,
  useSdk: () => host.sdk,
  UrlLink: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
let box: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  host.enabled = true;
  localStorage.clear();
  host.rpc.call.mockReset().mockImplementation(async (method: string) => method === "scroll_get" ? { atBottom: false, messageSeq: 42, offset: -30 } : method === "presence_read_point" ? { messageSeq: null } : { ok: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  box = document.createElement("div"); box.style.overflowY = "auto";
  const anchor = document.createElement("div");
  anchor.dataset.notificationThread = "one"; anchor.dataset.notificationMessage = "42";
  box.append(anchor); document.body.append(box);
  Object.defineProperties(box, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } });
  box.scrollTop = 1600;
  vi.spyOn(box, "getBoundingClientRect").mockImplementation(() => ({ top: 50, bottom: 450, height: 400 }) as DOMRect);
  vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: 550 - box.scrollTop, bottom: 750 - box.scrollTop, height: 200 }) as DOMRect);
});
afterEach(() => { cleanup(); history.replaceState(null, "", "/"); box.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("the registered presence component restores the stored message without a pill", async () => {
  const view = render(<ThreadPresence />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(box.scrollTop).toBe(530);
  expect(box.style.visibility).toBe("");
  expect(view.queryByRole("link")).toBeNull();
});
it("turning the setting off retains native scroll position", async () => {
  host.enabled = false;
  render(<ThreadPresence />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(box.scrollTop).toBe(1600);
  expect(host.rpc.call).not.toHaveBeenCalledWith("scroll_get", expect.anything());
});

it("respects explicit message links while still remembering subsequent reading", async () => {
  history.replaceState(null, "", "/#msg=42");
  render(<ThreadPresence />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(box.scrollTop).toBe(1600);
  expect(host.rpc.call).not.toHaveBeenCalledWith("scroll_get", expect.anything());
  act(() => { box.scrollTop = 530; box.dispatchEvent(new Event("scroll")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(host.rpc.call).toHaveBeenCalledWith("scroll_set", expect.objectContaining({ position: { atBottom: false, messageSeq: 42, offset: -30 } }));
});
it("restores again on focus return and does not sample background activity", async () => {
  render(<ThreadPresence />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  act(() => { vi.mocked(document.hasFocus).mockReturnValue(false); window.dispatchEvent(new Event("blur")); });
  await act(async () => {});
  const count = host.rpc.call.mock.calls.filter(([method]) => method === "scroll_set").length;
  box.scrollTop = 1600;
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(host.rpc.call.mock.calls.filter(([method]) => method === "scroll_set")).toHaveLength(count);
  act(() => { vi.mocked(document.hasFocus).mockReturnValue(true); window.dispatchEvent(new Event("focus")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(box.scrollTop).toBe(530);
});
it("requests older messages through the host router when the saved anchor is not rendered", async () => {
  const anchor = box.firstElementChild as HTMLElement;
  anchor.dataset.notificationMessage = "99";
  const route = vi.fn();
  window.addEventListener("popstate", route);
  render(<ThreadPresence />);
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  expect(location.hash).toBe("#msg=42");
  expect(route).toHaveBeenCalled();
  window.removeEventListener("popstate", route);
});
