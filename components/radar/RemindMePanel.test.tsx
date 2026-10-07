import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginMessageActionContext } from "@get-bb/plugin-sdk/app";
import { NEEDS_NOW, makeNeed } from "./needsFixtures";
const app = await loadPluginApp(() => import("../../app"));
const panel = app.threadPanelActions.find(action => action.id === "remind-when")!;
const action = app.messageActions.find(action => action.id === "remind-me")!;
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(NEEDS_NOW); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open(selectedText?: string, text = "BOT_READY_a\n\n**Pay school installment**\nThe rest") {
  const openPanel = vi.fn((_options: Parameters<PluginMessageActionContext["openPanel"]>[0]) => true);
  action.run({ threadId: "coord", message: { id: "msg1", text }, selectedText, openPanel } as unknown as PluginMessageActionContext);
  return openPanel.mock.calls[0]![0] as unknown as { params: { threadId: string; messageId: string; text: string } };
}
function mount(selectedText?: string) {
  const options = open(selectedText);
  const remind = vi.fn(() => ({ item: makeNeed({ kind: "reminder", state: "snoozed" }) }));
  const host = renderSlot(panel, { threadId: "coord", params: options.params }, { rpc: { crew_remind: remind } });
  return { host, remind, options };
}
describe("Remind me", () => {
  it("prefers selected text and preserves message identity through the panel", async () => {
    const { remind, options } = mount("  The highlighted sentence\nonly  ");
    expect(options.params).toEqual({ threadId: "coord", messageId: "msg1", text: "The highlighted sentence only" });
    fireEvent.click(screen.getByRole("button", { name: "Later today · 18:00" }));
    await screen.findByText("Reminder set.");
    expect(remind).toHaveBeenCalledExactlyOnceWith({ threadId: "coord", messageId: "msg1", text: "The highlighted sentence only", until: "2026-10-07T15:00:00.000Z" });
  });
  it("uses the first meaningful line, and native custom date/time in Cairo", async () => {
    const { remind } = mount();
    expect(screen.getByText("Pay school installment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pick a date…" }));
    const input = screen.getByLabelText("Date and time (Cairo)");
    expect(input.getAttribute("type")).toBe("datetime-local");
    fireEvent.change(input, { target: { value: "2026-11-02T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Set reminder" }));
    await waitFor(() => expect(remind).toHaveBeenCalledWith(expect.objectContaining({ text: "Pay school installment", until: "2026-11-02T07:00:00.000Z" })));
  });
  it("keeps choices available after missing-backend failure", async () => {
    const { remind } = mount(); remind.mockImplementationOnce(() => { throw new Error("unknown_method"); });
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow · 09:00" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Monday · 09:00" }));
    await screen.findByText("Reminder set.");
  });
  it("trims message text and reports a declined panel open", () => {
    expect(open(undefined, "x".repeat(180)).params.text).toHaveLength(120);
    expect(() => action.run({ threadId: "coord", message: { id: "m", text: "Pay" }, openPanel: () => false } as unknown as PluginMessageActionContext)).toThrow(/Open the message/);
  });
});
