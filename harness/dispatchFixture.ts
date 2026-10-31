import { BOT_SEEDS, makeBot, makeOutput, makeTask } from "@/components/radar/botTasksFixtures";
import { NOW, MINUTE, HOUR, DAY } from "@/components/radar/fixtures";
function tomorrowAt(hours: number, minutes: number) {
  const at = new Date(NOW);
  at.setDate(at.getDate() + 1);
  at.setHours(hours, minutes, 0, 0);
  return at.getTime();
}
const home = [
  makeTask("home", "Root cause of recurring Kitchen TV wrong-colour fault identified among our Oct 17-18 changes (or ruled out per candidate), with reversible fix", "waiting", { id: "dispatch_waiting", waitFor: "the bot", wakeAt: tomorrowAt(19, 30) }),
  makeTask("home", "Kitchen TV runs the Clean Your TV launcher as Home, looking good and fast, with AT4K kept for one-step rollback", "done", { id: "dispatch_cancelled", line: "Cancelled", completedAt: NOW - 3 * HOUR }),
  makeTask("home", "Second Xiaomi TV (MiTV-MOSR4 \"TV\" at 192.168.1.227) tuned like the Kitchen TV: Clean Your TV launcher as Home, clutter feeds off, with one-step rollback", "done", { id: "dispatch_done_1", line: "Done 20 Sep", completedAt: NOW - DAY }),
  makeTask("home", "Kitchen TV wrong-colour report investigated: physical state checked via kitchen camera, launcher cause assessed, fault cleared if present", "done", { id: "dispatch_done_2", line: "Done 19 Sep", completedAt: NOW - 2 * DAY }),
];
export function dispatchFixture() {
  return makeOutput(BOT_SEEDS.map(seed => makeBot(seed, seed.key === "bricks" ? [makeTask(seed.key, "Connect the test iPhone", "needs", { id: "dispatch_ask", ageMs: 9 * MINUTE, needs: { threadId: "thr_coord_bricks", interactionId: "dispatch_ask", question: "Connect the test iPhone?" } })] : seed.key === "home" ? home : seed.key === "lab" ? [makeTask(seed.key, "Bots sidebar mockups", "working", { id: "dispatch_lab" }), makeTask(seed.key, "Review the sidebar", "working", { id: "dispatch_review" })] : seed.key === "erbareeq" ? [makeTask(seed.key, "Reconcile daily sales", "working", { id: "dispatch_sales" })] : [makeTask(seed.key, "Daily check", "done", { completedAt: NOW - (seed.key === "work" ? 4 : 3) * HOUR })])));
}
const RUNNING = ["dispatch_lab", "dispatch_review", "dispatch_sales"];
export function dispatchDetail(id: string) {
  const model = id === "dispatch_lab" ? "Opus" : id === "dispatch_review" ? "Astra" : id === "dispatch_waiting" ? "codex/gpt-6.1-sol" : "Sol";
  return { taskId: id, outcome: "", workers: [...RUNNING, "dispatch_waiting"].includes(id) ? [{ threadId: `worker_${id}`, title: "Worker", model, effort: null, state: RUNNING.includes(id) ? "running" : "idle" }] : [], history: [], conversation: null };
}
export function dispatchThreads() {
  return [
    ...RUNNING.map(id => ({ id: `worker_${id}`, title: "Worker", status: "running", createdAt: NOW - (id === "dispatch_sales" ? 4 : 18) * MINUTE, updatedAt: NOW })),
    { id: "thr_coord_personal", title: "Personal Bot", status: "active", createdAt: NOW - 30 * DAY, updatedAt: NOW },
    { id: "worker_dispatch_waiting", title: "Kitchen TV colour fault", status: "idle", createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY + 31 * MINUTE },
  ];
}
