// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BotsView } from "./BotsView";
import { botTasksSchema } from "@/lib/botTasks";
import { makeBot, makeOutput, makeTask, BOT_SEEDS } from "./botTasksFixtures";
import { NOW } from "./fixtures";
import { plainNote, splitStatus, taskHeadline } from "./workText";
import { ListModeSwitch } from "./ListModeSwitch";
import { AUTOMATIONS_ROUTE, automationsHref } from "./automationsLink";

const LONG_TITLE = "ERBareeq web app audited with Emil Kowalski's remove-animations skill: unnecessary animations and delays found and ranked, report first, fixes only after Salem picks, on a separate copy";
const LONG_LINE = "Salem chose all three recommended sets with a before/after report; expo fix worker thr_ejgbgsc6v4 running, then review, then deploy/OTA decision";
const workers = vi.hoisted(() => ({ byTask: {} as Record<string, unknown[]> }));
vi.mock("./useDispatchWorkers", () => ({ useDispatchWorkers: () => ({ byTask: workers.byTask, byBot: { erbareeq: Object.values(workers.byTask).flat() }, known: new Set(["erbareeq"]), chat: new Set() }) }));
afterEach(() => { cleanup(); workers.byTask = {}; window.history.replaceState(null, "", "/"); });

function sheet(scope?: string) {
  const d = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0], [makeTask("erbareeq", LONG_TITLE, "working", { id: "audit", line: LONG_LINE, conversationThreadId: "thr_audit" })])]));
  workers.byTask = { audit: [
    { threadId: "thr_running1", title: "Expo fix", model: "anthropic/claude-opus-5-5", effort: null, state: "running", startedAt: NOW - 4 * 60_000, endedAt: null, latest: true },
    { threadId: "thr_idle0001", title: "Audit pass", model: "codex/gpt-6.1-sol", effort: null, state: "idle", startedAt: NOW - 30 * 60_000, endedAt: NOW - 14 * 60_000, latest: false },
  ] };
  const onOpen = vi.fn();
  const delegate = vi.fn((event: React.MouseEvent) => {
    const anchor = (event.target as Element).closest("a[href]");
    return { anchor: anchor?.getAttribute("href") ?? null, connected: !!anchor?.isConnected, prevented: event.defaultPrevented, overlay: anchor?.closest("[data-bb-portaled-overlay]")?.getAttribute("data-bb-plugin") ?? null };
  });
  const view = render(<div data-bb-plugin={scope} onClick={delegate}><BotsView state={{ data: d, status: "ready", cached: false }} activeThreadId={null} isCompactViewport now={NOW} onOpen={onOpen} onShowThreads={vi.fn()} /></div>);
  const work = screen.getByRole("button", { name: /^Show ERBareeq's work/ });
  work.focus(); fireEvent.click(work);
  return { view, onOpen, delegate, dialog: screen.getByRole("dialog") };
}

it("turns a long technical title and progress line into a readable headline and note", () => {
  expect(taskHeadline(LONG_TITLE)).toBe("ERBareeq web app audited with Emil Kowalski's remove-animations skill");
  expect(taskHeadline("Emil Kowalski's break-ui method run on ERBareeq key screens (admin dashboard, a sales report, installer redemption review) with realistic data")).toBe("Emil Kowalski's break-ui method run on ERBareeq key screens with realistic data");
  expect(taskHeadline("Fix it: now")).toBe("Fix it: now");
  expect(plainNote(LONG_LINE)).toBe("Salem chose all three recommended sets with a before/after report; expo fix worker running, then review, then deploy/OTA decision");
  expect(plainNote("worker (thr_abcdef1234) done")).toBe("worker done");
  expect(splitStatus(`Working · ${LONG_LINE}`)).toEqual({ state: "Working", meta: "", note: LONG_LINE });
  expect(splitStatus("Stopped by Salem · today 08:00 · 2 workers halted")).toEqual({ state: "Stopped by Salem", meta: "today 08:00 · 2 workers halted", note: "" });
});

it("keeps ids out of the task row and every original word, id and link in its details", () => {
  const { dialog, onOpen } = sheet();
  const card = dialog.querySelector<HTMLElement>(".dispatch-open .dispatch-task-group")!;
  const row = card.querySelector<HTMLElement>(".dispatch-task")!;
  expect(row.querySelector("b")!.textContent).toBe("ERBareeq web app audited with Emil Kowalski's remove-animations skill");
  expect(row.querySelector(".dispatch-status-line")!.textContent).toBe("Working");
  expect(row.textContent).not.toMatch(/thr_/);
  expect(card.querySelector(".dispatch-workers")!.textContent).toBe("Opus · running 4 min");
  const details = card.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")!.textContent).toBe("Details · 1 idle");
  expect(details.querySelector(".dispatch-full")!.textContent).toBe(LONG_TITLE);
  expect(details.querySelector(".dispatch-full-status")!.textContent).toBe(`Working · ${LONG_LINE}`);
  expect(Array.from(details.querySelectorAll("code")).map(node => node.textContent)).toEqual(["thr_running1", "thr_idle0001"]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Open worker Audit pass: Sol worker, idle 14 min (thr_idle0001)" }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("thr_idle0001");
});

it("offers Automations beside Chat and More as a real route the host delegate can follow", () => {
  const { dialog, delegate } = sheet("radar-sidebar");
  const link = within(dialog).getByRole("link", { name: "Automations" });
  expect(link.getAttribute("href")).toBe("/plugins/bots-page/bots/erbareeq/automations");
  expect(within(dialog).getByRole("button", { name: "Chat" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "More" })).toBeTruthy();
  const before = delegate.mock.calls.length;
  fireEvent.click(link);
  expect(delegate).toHaveBeenCalledTimes(before + 1);
  expect(delegate.mock.results.at(-1)!.value).toEqual({ anchor: "/plugins/bots-page/bots/erbareeq/automations", connected: true, prevented: false, overlay: "radar-sidebar" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("leaves modified clicks on the Automations link to the browser and keeps the sheet open", () => {
  const { dialog } = sheet("radar-sidebar");
  fireEvent.click(within(dialog).getByRole("link", { name: "Automations" }), { metaKey: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("tabs past controls inside collapsed details and into them once opened", () => {
  const { dialog } = sheet();
  const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary')).filter(node => { const closed = node.closest("details:not([open])"); return !closed || node.parentElement === closed && node.tagName === "SUMMARY"; }).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  const first = focusable()[0]!, last = focusable().at(-1)!;
  expect(last.tagName).toBe("SUMMARY");
  last.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  first.focus();
  fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  (last.parentElement as HTMLDetailsElement).open = true;
  const opened = focusable().at(-1)!;
  expect(opened.tagName).toBe("BUTTON");
  expect(opened.getAttribute("aria-label")).toMatch(/\(thr_idle0001\)$/);
  opened.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  expect(document.activeElement).toBe(first);
});

it("holds only Bots and Threads; automations open per bot from its Work panel", () => {
  const onChange = vi.fn();
  render(<ListModeSwitch mode="bots" onChange={onChange} needsCount={2} />);
  const group = screen.getByRole("group", { name: "Show bots or threads" });
  expect(within(group).getAllByRole("button").map(button => button.textContent)).toEqual(["Bots2", "Threads"]);
  expect(within(group).queryByRole("link")).toBeNull();
  expect(within(group).getByRole("button", { name: "Bots, 2 need you" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(group).getByRole("button", { name: "Threads" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("threads");
});

it("puts a dot on the Bots tab while Threads is shown and a bot has an unread reply", () => {
  const view = render(<ListModeSwitch mode="threads" onChange={vi.fn()} needsCount={null} unreadBots={2} />);
  const bots = screen.getByRole("button", { name: "Bots, 2 with unread replies" });
  expect(bots.querySelector(".radar-mode-dot")).toBeTruthy();
  view.rerender(<ListModeSwitch mode="bots" onChange={vi.fn()} needsCount={null} unreadBots={2} />);
  expect(screen.getByRole("button", { name: "Bots" }).querySelector(".radar-mode-dot")).toBeNull();
});

it("builds per-bot automation routes for the Page plugin", () => {
  expect(automationsHref("lab")).toBe("/plugins/bots-page/bots/lab/automations");
  expect(automationsHref(null)).toBe(AUTOMATIONS_ROUTE);
});

it("marks a bot whose chat has an unread reply, except the chat already open", () => {
  const d = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0], [])]));
  const chat = d.bots[0]!.coordinatorThreadId;
  const view = render(<BotsView state={{ data: d, status: "ready", cached: false }} activeThreadId={null} isCompactViewport now={NOW} onOpen={vi.fn()} onShowThreads={vi.fn()} unreadChats={new Set([chat])} />);
  const open = screen.getByRole("button", { name: /^Open ERBareeq Bot chat, unread reply$/ });
  expect(open.closest(".dispatch-row")!.classList.contains("dispatch-unread")).toBe(true);
  expect(open.querySelector(".dispatch-unread-dot")).toBeTruthy();
  view.rerender(<BotsView state={{ data: d, status: "ready", cached: false }} activeThreadId={chat} isCompactViewport now={NOW} onOpen={vi.fn()} onShowThreads={vi.fn()} unreadChats={new Set([chat])} />);
  expect(screen.getByRole("button", { name: /^Open ERBareeq Bot chat$/ })).toBeTruthy();
});
