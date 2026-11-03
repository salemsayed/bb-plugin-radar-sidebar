import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const threadId = "thr_lab_demo";
const chat = document.getElementById("chat")!;
const messages = [
  [40, "user", "Check the plugin builds while I’m away."],
  [42, "assistant", "I’ll check the builds and test the affected flows."],
  [45, "assistant", "The Radar build passed. I found one issue in the phone layout and I’m checking it now."],
  [51, "assistant", "The phone layout is fixed. The button now fits at 390 pixels without wrapping."],
  [56, "assistant", "All checks passed. I’ve saved the branch for you to review. Nothing has been deployed."],
] as const;
for (const [seq, role, text] of messages) {
  const row = document.createElement("article");
  row.id = `message-${seq}`;
  row.className = role;
  row.dataset.notificationThread = threadId;
  row.dataset.notificationMessage = String(seq);
  const label = document.createElement("b");
  label.textContent = role === "user" ? "You" : "Lab Bot";
  const body = document.createElement("p");
  body.textContent = text;
  row.append(label, body);
  if (seq === 51) {
    for (const text of ["Phone layout", "Desktop layout", "Keyboard navigation", "Message links", "Thread switching", "Read point storage", "Focus and visibility", "Build output", "Regression checks", "Final checks", "Theme colors", "Sidebar layout", "Composer spacing", "Thread navigation", "Split panes", "Page visibility", "Hidden messages", "Occluded messages", "Offscreen messages", "Equal timestamps", "Message order", "Duplicate anchors", "Empty chats", "First visits", "Return navigation"]) {
      const check = document.createElement("p");
      check.textContent = `${text}: passed. The result is saved with the branch for review.`;
      row.append(check);
    }
  }
  chat.append(row);
}
chat.scrollTop = chat.scrollHeight;
const app = await loadPluginApp(() => import("../app"));
const slot = renderSlot(app.appOverlays[0]!, {}, {
  context: { threadId, projectId: "proj_lab" },
  sidebarSplitLayout: { panes: [{ paneId: "chat", threadId, isFocused: true, rect: { x: innerWidth > 700 ? 260 : 0, y: 0, width: innerWidth > 700 ? innerWidth - 260 : innerWidth, height: innerHeight } }] },
  rpc: {
    scroll_get: () => JSON.parse(localStorage.getItem("radar-preview-position") ?? '{"atBottom":false,"messageSeq":51,"offset":-24}'),
    scroll_set: ({ position }: { position: unknown }) => { localStorage.setItem("radar-preview-position", JSON.stringify(position)); return { ok: true }; },
    presence_read_point: () => ({ through: 1000, messageSeq: 42, confirmedAt: 1000 }),
    presence_heartbeat: () => ({ ok: true }),
  },
  sdk: { threads: {
    markRead: async () => ({ ok: true }),
    timeline: async () => ({ rows: messages.map(([messageSeq]) => ({ kind: "conversation", messageSeq })), timelinePage: { olderCursor: null } }),
    events: { list: async ({ afterSeq }: { afterSeq: string }) => [{ seq: Number(afterSeq) + 1, createdAt: 2000 }] },
  } },
  openUrl: (url: string) => {
    const seq = Number(new URL(url, location.origin).hash.slice(5));
    const target = document.getElementById(`message-${seq}`);
    if (!target) return false;
    target.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#msg=${seq}`);
    return true;
  },
} as never);
document.body.append(slot.container);
Object.assign(window, { harnessReady: true, harnessLog: () => ({ navigation: slot.inspection.navigateCalls, rpc: slot.inspection.rpcCalls }) });
