import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  resetRailScope,
  setRailScope,
  subscribeRailScope,
  useRailScope,
  useValidatedRailScope,
} from "./railScope";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetRailScope();
  localStorage.clear();
});

describe("rail scope store", () => {
  it("notifies and persists once, treating the same value as a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRailScope(listener);
    const write = vi.spyOn(Storage.prototype, "setItem");
    setRailScope("proj_a");
    setRailScope("proj_a");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBe("proj_a");
    setRailScope(null);
    setRailScope(null);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem("radar-sidebar:rail-bot-scope:v1")).toBeNull();
    unsubscribe();
  });

  it("removes only the departing listener and makes teardown idempotent", () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = subscribeRailScope(first);
    const offSecond = subscribeRailScope(second);
    offFirst();
    offFirst();
    setRailScope("proj_a");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    offSecond();
    setRailScope("proj_b");
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps mounted consumers working when storage quota or access fails", () => {
    const { result, unmount } = renderHook(useRailScope);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Denied", "SecurityError");
    });
    act(() => setRailScope("proj_a"));
    expect(result.current).toBe("proj_a");
    act(() => setRailScope(null));
    expect(result.current).toBeNull();
    unmount();
    expect(() => setRailScope("proj_b")).not.toThrow();
  });
});

describe("retired crew scope", () => {
  const bot = { key: "personal", name: "Personal Bot", current: "root", projectId: "proj_a", projects: [], hostId: "host_1", providerId: "pi", model: "test", rollover: null };
  it("a saved key that names no bot shows every thread", () => {
    setRailScope("__crew__");
    expect(renderHook(() => useValidatedRailScope([bot], true)).result.current).toBeNull();
  });
});
