// Visual harness: Radar's real thread-list slot, rendered through the SDK's
// test runtime with bot_tasks fixtures, inside a bb-like shell.
// Query: ?size=desktop|tablet|phone&fixture=normal|peak|ten|rtl|missing|loading&mode=bots|threads&theme=light|dark&active=<threadId>
//        &sidebar=<px> (desktop/tablet sidebar width) &dir=rtl &detail=missing (a core without task_detail)
//        &focus=<botKey> (a desk to press) &open=<waiting|done|earlier>,… (bands to unfold) &info=<taskId> (a task's details to open)
import { NOW, makeThread } from "@/components/radar/fixtures";
import { attemptThreads, normalDay, peakDay, quietDay, rtlAndEmpty, taskDetails, tenDecisions } from "@/components/radar/botTasksFixtures";
import { LIST_MODE_KEY } from "@/components/radar/ListModeSwitch";
import type { BotTasksOutput } from "@/lib/tasks-v2-types";
import { recordedActions, threadActionsFixture } from "@/components/radar/threadActions.fixtures";

const params = new URLSearchParams(location.search);
const size = params.get("size") ?? "desktop";
const fixture = params.get("fixture") ?? "normal";
const mode = params.get("mode") ?? "bots";
const theme = params.get("theme") ?? "light";
const active = params.get("active");
document.documentElement.dataset.theme = theme;
document.body.dataset.size = size;
if (params.get("dir") === "rtl") document.documentElement.dir = "rtl";
if (size === "tablet") document.documentElement.style.setProperty("--sidebar", "280px");
if (params.get("sidebar")) document.documentElement.style.setProperty("--sidebar", `${params.get("sidebar")}px`);

// ?sheet=faces: every character in every state, large and at row size, for reviewing the art alone.
if (params.get("sheet") === "faces") {
  const [{ createRoot }, { createElement: h }, { BotFace }] = await Promise.all([import("react-dom/client"), import("react"), import("@/components/radar/BotFace")]);
  const keys = ["personal", "home", "bricks", "work", "erbareeq", "lab"];
  const states = [undefined, "working", "needs-you", "failed", "unavailable"] as const;
  document.getElementById("frame")!.style.display = "block";
  createRoot(document.getElementById("frame")!).render(h("div", { style: { padding: 16, display: "grid", gap: 12 } },
    keys.map(key => h("div", { key, style: { display: "flex", alignItems: "end", gap: 14 } },
      h("b", { style: { width: 70, fontSize: 13 } }, key),
      states.map(state => h("span", { key: String(state), style: { display: "inline-flex", alignItems: "end", gap: 6 } },
        h(BotFace, { botKey: key, name: key, state, size: 88 }), h(BotFace, { botKey: key, name: key, state, size: 36 }), h(BotFace, { botKey: key, name: key, state, size: 20 }))))),
  ));
  (window as unknown as { harnessReady: boolean }).harnessReady = true;
  await new Promise(() => {});
}

// Fixtures are dated around NOW; the page's clock starts there and runs on.
const RealDate = Date;
const started = RealDate.now();
class HarnessDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(NOW + (RealDate.now() - started));
    else super(...(args as [number]));
  }
  static now() { return NOW + (RealDate.now() - started); }
}
globalThis.Date = HarnessDate as DateConstructor;

localStorage.clear();
localStorage.setItem(LIST_MODE_KEY, mode);

const { loadPluginApp, renderSlot } = await import("@get-bb/plugin-sdk/testing/app");
const app = await loadPluginApp(() => import("../app"));

const tasks: Record<string, (() => BotTasksOutput) | "missing" | "loading"> = {
  normal: normalDay, quiet: quietDay, peak: peakDay, ten: tenDecisions, rtl: rtlAndEmpty, missing: "missing", loading: "loading",
};
const roster = ["erbareeq", "bricks", "home"].map(key => ({
  key, name: `${key[0]!.toUpperCase()}${key.slice(1)} Bot`, current: `thr_coord_${key}`, projectId: `proj_${key}`, projects: [],
  hostId: "host_solom", providerId: "codex", model: "gpt-6.1-sol", rollover: null,
}));
const threads = [
  makeThread({ id: "thr_coord_erbareeq", projectId: "proj_erbareeq", title: "ERBareeq Bot", updatedAt: NOW - 3 * 60_000 }),
  makeThread({ id: "thr_task_t_replit", projectId: "proj_erbareeq", parentThreadId: "thr_coord_erbareeq", title: "Move the backend off Replit", updatedAt: NOW - 60 * 60_000 }),
  makeThread({ id: "thr_worker_review", projectId: "proj_erbareeq", lifecycleOwnerThreadId: "thr_coord_erbareeq", title: "Fable review: deploy window", updatedAt: NOW - 20 * 3_600_000 }),
  makeThread({ id: "thr_coord_bricks", projectId: "proj_bricks", title: "Bricks Bot", updatedAt: NOW - 3 * 3_600_000 }),
  makeThread({ id: "thr_coord_home", projectId: "proj_home", title: "Home Bot", updatedAt: NOW - 5 * 3_600_000 }),
  makeThread({ id: "thr_plain", projectId: "proj_misc", title: "Untitled plain thread", updatedAt: NOW - 2 * 86_400_000 }),
  makeThread({ id: "thr_plain_rtl", projectId: "proj_misc", title: "مراجعة سريعة لملف الأسعار", updatedAt: NOW - 26 * 3_600_000 }),
];
const projects = ["proj_erbareeq", "proj_bricks", "proj_home", "proj_misc"].map(id => ({ id, name: id.replace("proj_", ""), path: `/home/salem/${id}` }));

const sdk: Record<string, unknown> = {
  threads: {
    // Worker threads behind the attempts list answer by id; everything else lists nothing.
    list: async (query?: { threadIds?: readonly string[] }) => query?.threadIds ? attemptThreads().filter(thread => query.threadIds!.includes(thread.id)) : [],
    defaultExecutionOptions: async () => null, context: async () => ({ usage: null }),
    markRead: async () => ({ ok: true }), output: async () => ({ output: null }), timeline: async () => ({ segments: [] }),
  },
  providers: { models: async () => ({ models: [] }) },
  system: { uiPreferences: { list: async () => ({ preferences: {} }), set: async () => ({ revision: 1, value: [] }) } },
  plugins: {
    callRpc: async ({ method, input }: { method: string; input?: unknown }) => {
      if (method === "bot_roster") return { bots: roster };
      if (method === "bot_tasks") {
        const source = tasks[fixture] ?? normalDay;
        if (source === "missing") throw new Error('HTTP 404: plugin "orchestrator-mode" has no rpc method "bot_tasks"');
        if (source === "loading") return new Promise(() => {});
        return source();
      }
      if (method === "task_detail" && params.get("detail") !== "missing") {
        const found = taskDetails()[(input as { taskId: string }).taskId];
        if (!found) throw new Error("Task not found");
        return found;
      }
      throw new Error(`plugin "orchestrator-mode" has no rpc method "${method}"`);
    },
  },
};

const frame = document.getElementById("frame")!;
frame.innerHTML = `<div class="h-rail"></div><aside class="h-side"><div class="h-drawerbar"><span>bb</span><span>✕</span></div></aside><div class="h-scrim"></div><main class="h-main"><h1>Thread view</h1><p id="opened">Nothing opened yet.</p></main>`;
// bb's core thread actions (pin, rename, archive, delete) in their public shape, recorded, as the tests use them.
const actions = threadActionsFixture();
const slot = actions.capture(renderSlot(app.threadLists[0]!, {
  activeThreadId: active, activeProjectId: null, isCompactViewport: size === "phone",
  onNavigate: () => { document.getElementById("opened")!.dataset.closed = String(Number(document.getElementById("opened")!.dataset.closed ?? 0) + 1); },
  searchQuery: "",
}, {
  sdk, settings: { botsSwitch: true, botsPage: true, hoverCard: false },
  rpc: { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }), working_digest: () => ({ digests: [] }) },
  threadActions: actions.threadActions,
  sidebarThreads: { status: "ready", threads, projects, sections: [], experimental_archived: null },
} as never));
// What a driver script needs to check: every thread opened, every drawer close, every menu action run.
(window as unknown as { harnessLog: () => unknown }).harnessLog = () => ({
  opened: slot.inspection.navigateCalls.filter(call => call.method === "toThread").map(call => (call as { threadId?: string }).threadId),
  closes: Number(document.getElementById("opened")!.dataset.closed ?? 0),
  actions: recordedActions(slot).filter(call => call.method !== "open"),
});
frame.querySelector(".h-side")!.appendChild(slot.container);
// What a tap opened, for the tap-count checks.
setInterval(() => {
  const calls = slot.inspection.navigateCalls.filter(call => call.method === "toThread");
  const last = calls[calls.length - 1] as { threadId?: string } | undefined;
  const node = document.getElementById("opened")!;
  node.textContent = last ? `Opened ${last.threadId} (${calls.length} open${calls.length === 1 ? "" : "s"})` : "Nothing opened yet.";
  node.dataset.opened = last?.threadId ?? "";
}, 100);
// A tile, folds and a task's details the screenshot wants open: pressed once each, as a reader would.
const wantedFocus = params.get("focus");
const wantedFolds = (params.get("open") ?? "").split(",").filter(Boolean);
const wantedInfo = params.get("info");
let focused = !wantedFocus;
const opener = setInterval(() => {
  if (!focused) {
    const tile = document.querySelector<HTMLButtonElement>(`.radar-desk[data-bot="${wantedFocus}"]`);
    if (!tile) return;
    if (tile.getAttribute("aria-pressed") !== "true") tile.click();
    focused = true;
    return;
  }
  let pending = false;
  for (const kind of wantedFolds) {
    const fold = document.querySelector<HTMLButtonElement>(`[data-fold="${kind}"]`);
    if (!fold) { pending = true; continue; }
    if (fold.getAttribute("aria-expanded") === "false") fold.click();
  }
  if (wantedInfo) {
    const toggle = document.querySelector<HTMLButtonElement>(`[data-info-task="${wantedInfo}"]`);
    if (!toggle) pending = true;
    else if (toggle.getAttribute("aria-expanded") === "false") toggle.click();
  }
  if (!pending) clearInterval(opener);
}, 100);
(window as unknown as { harnessReady: boolean }).harnessReady = true;
