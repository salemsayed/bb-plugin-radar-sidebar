import { afterEach, expect, it, vi } from "vitest";
import { primeScrollRoute } from "./primeScrollRoute";
afterEach(() => { localStorage.clear(); sessionStorage.clear(); history.replaceState(null, "", "/"); });
it("leaves a cold document on the native latest view instead of seeding a message link", () => {
  history.replaceState(null, "", "/threads/one");
  localStorage.setItem("radar-scroll:one", JSON.stringify({ atBottom: false, messageSeq: 42, offset: -30 }));
  primeScrollRoute();
  expect(location.hash).toBe("");
});
it("preserves an explicit message link on an ordinary navigation", () => {
  history.replaceState(null, "", "/threads/one#msg=42");
  sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId: "one", hash: "#msg=42", at: Date.now() }));
  primeScrollRoute();
  expect(location.hash).toBe("#msg=42");
});

it("notifies the host when removing an owned fragment on reload", async () => {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "reload" } as PerformanceNavigationTiming]);
  vi.resetModules();
  history.replaceState(null, "", "/threads/one#msg=42");
  const { primeScrollRoute: prime } = await import("./primeScrollRoute");
  sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId: "one", hash: "#msg=42", at: Date.now() }));
  const changed = vi.fn();
  window.addEventListener("popstate", changed);
  try { prime(); expect(location.hash).toBe(""); expect(changed).toHaveBeenCalledOnce(); }
  finally { window.removeEventListener("popstate", changed); vi.restoreAllMocks(); }
});
