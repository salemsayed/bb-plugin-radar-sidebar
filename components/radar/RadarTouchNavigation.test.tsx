import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeThread } from "./fixtures";
import { threadActionsFixture } from "./threadActions.fixtures";

const app = await loadPluginApp(() => import("../../app"));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mount(working = false, compact = true) {
  vi.stubGlobal("matchMedia", () => ({matches: true}));
  // Browsers focus links after mousedown unless that default is cancelled.
  // jsdom needs an explicit pointer type and has no native focus default.
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  });
  vi.stubGlobal("IntersectionObserver", class {
    observe() {} unobserve() {} disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {} unobserve() {} disconnect() {}
  });
  const navigated = vi.fn();
  const actions = threadActionsFixture();
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: compact,
    onNavigate: navigated, searchQuery: "",
  }, {
    settings: { hideWorking: working }, threadActions: actions.threadActions,
    sidebarThreads: { status: "ready", threads: [makeThread({id: "tap", status: working ? "active" : "idle"})],
      projects: [makeProject({id: "proj_a"})], sections: [] },
    sdk: { threads: { defaultExecutionOptions: async () => null }, providers: { models: async () => ({
      models: [], selectedOnlyModels: [], permissionCeiling: "full", providers: [], modelLoadError: null,
    }) } },
  });
  // BB's route delegate consumes anchor defaults after the row's handler.
  slot.container.addEventListener("click", event => event.preventDefault());
  if (working) fireEvent.click(screen.getByRole("button", {name: "Working, 1 thread"}));
  const link = slot.container.querySelector<HTMLAnchorElement>('[data-sidebar-thread-id="tap"]')!;
  return {slot, link, navigated};
}

function press(link: HTMLElement, pointerType: string) {
  fireEvent.pointerDown(link, {pointerType});
  const event = new MouseEvent("mousedown", {bubbles: true, cancelable: true, button: 0});
  fireEvent(link, event);
  if (!event.defaultPrevented) act(() => link.focus());
  return event;
}

describe("touch thread navigation", () => {
  it.each([true, false])("keeps Working row content unchanged during touch hover emulation (compact=%s)", compact => {
    const {link, navigated} = mount(true, compact);
    const row = link.closest(".radar-row")!;
    const more = screen.getByRole("button", {name: "More actions"});
    const content = row.innerHTML;
    fireEvent.pointerEnter(row, {pointerType: "touch"});
    fireEvent.pointerDown(link, {pointerType: "touch"});
    fireEvent.touchStart(link, {touches: [{clientX: 100, clientY: 100}]});
    fireEvent.touchEnd(link, {touches: []});
    // iOS emulates hover first and can withhold click when it changes content.
    fireEvent.mouseOver(link);
    fireEvent.mouseMove(link);
    expect(more.isConnected).toBe(true);
    expect(row.innerHTML).toBe(content);
    fireEvent.click(link);
    expect(navigated).toHaveBeenCalledOnce();
  });

  it("prepares hover actions for an actual mouse and clears them on leave", () => {
    const {link} = mount(true, false);
    const row = link.closest(".radar-row")!;
    const more = screen.getByRole("button", {name: "More actions"});
    fireEvent.pointerEnter(row, {pointerType: "mouse"});
    expect(more.isConnected).toBe(false);
    expect(row.getAttribute("data-radar-hover")).toBe("mouse");
    fireEvent.pointerLeave(row, {pointerType: "mouse"});
    expect(row.hasAttribute("data-radar-hover")).toBe(false);
  });

  it("opens More on the first touch without replacing its trigger during native focus", () => {
    const {link} = mount(true);
    link.scrollIntoView = vi.fn();
    const more = screen.getByRole("button", {name: "More actions"});
    press(more, "touch");
    expect(more.isConnected).toBe(true);
    fireEvent.mouseUp(more);
    fireEvent.click(more);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(link.scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps a deferred link mounted through a touch tap's compatibility mouse events", () => {
    const {link, navigated} = mount();
    expect(link.closest(".radar-row-placeholder")).toBeTruthy();
    press(link, "touch");
    // Focusing the placeholder here replaces the link before mouseup/click.
    expect(link.isConnected).toBe(true);
    fireEvent.mouseUp(link);
    fireEvent.click(link);
    expect(navigated).toHaveBeenCalledOnce();
  });

  it("avoids intermediate native focus when tapping a Working row", () => {
    const {link, navigated} = mount(true);
    expect(link.closest(".radar-working-drawer")).toBeTruthy();
    const event = press(link, "touch");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(link);
    fireEvent.mouseUp(link);
    fireEvent.click(link);
    expect(navigated).toHaveBeenCalledOnce();
  });

  it("retains native mouse focus after a touch interaction", () => {
    const {link} = mount(true);
    press(link, "touch");
    const event = press(link, "mouse");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it.each([{ctrlKey: true}, {metaKey: true}, {shiftKey: true}])(
    "keeps modified touch clicks as selection gestures (%j)", modifiers => {
      const {link, navigated} = mount(true);
      press(link, "touch");
      fireEvent.mouseUp(link);
      fireEvent.click(link, modifiers);
      expect(navigated).not.toHaveBeenCalled();
      expect(link.closest(".radar-row-selected")).toBeTruthy();
    },
  );
});
