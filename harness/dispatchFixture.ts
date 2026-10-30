import { BOT_SEEDS, makeBot, makeOutput, makeTask } from "@/components/radar/botTasksFixtures";
import { NOW, MINUTE, HOUR } from "@/components/radar/fixtures";
export function dispatchFixture() {
  return makeOutput(BOT_SEEDS.map(seed => makeBot(seed, seed.key === "bricks" ? [makeTask(seed.key, "Connect the test iPhone", "needs", { id: "dispatch_ask", ageMs: 9 * MINUTE, needs: { threadId: "thr_coord_bricks", interactionId: "dispatch_ask", question: "Connect the test iPhone?" } })] : seed.key === "home" ? [makeTask(seed.key, "Camera check paused", "offline", { id: "dispatch_blocked", line: "Host offline", retryAt: NOW + 34 * MINUTE })] : seed.key === "lab" ? [makeTask(seed.key, "Bots sidebar mockups", "working", { id: "dispatch_lab" }), makeTask(seed.key, "Review the sidebar", "working", { id: "dispatch_review" })] : seed.key === "erbareeq" ? [makeTask(seed.key, "Reconcile daily sales", "working", { id: "dispatch_sales" })] : [makeTask(seed.key, "Daily check", "done", { completedAt: NOW - (seed.key === "work" ? 4 : 3) * HOUR })])));
}
export function dispatchDetail(id: string) {
  const model = id === "dispatch_lab" ? "Opus" : id === "dispatch_review" ? "Astra" : "Sol";
  return { taskId: id, outcome: "", workers: ["dispatch_lab", "dispatch_review", "dispatch_sales"].includes(id) ? [{ threadId: `worker_${id}`, title: "Worker", model, effort: null, state: "running" }] : [], history: [], conversation: null };
}
export function dispatchThreads() {
  return ["dispatch_lab", "dispatch_review", "dispatch_sales"].map(id => ({ id: `worker_${id}`, title: "Worker", status: "running", createdAt: NOW - (id === "dispatch_sales" ? 4 : 18) * MINUTE, updatedAt: NOW }));
}
