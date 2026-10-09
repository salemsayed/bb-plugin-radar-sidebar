import { expect, it } from "vitest";
import { crewActivity } from "./crewActivity";
import { makeThread } from "./fixtures";
import type { RosterBot } from "./bots";

const bot: RosterBot = { key: "home", name: "Home Bot", current: "new", coordinatorIds: ["old", "new"], projectId: "home", projects: [], hostId: "h", providerId: "p", model: "m", rollover: null };

it("includes real hidden and cross-project work across rollover, but excludes unrelated and archived work", () => {
  const rows = crewActivity([bot], [
    makeThread({ id: "new" }),
    makeThread({ id: "old", status: "active" }),
    makeThread({ id: "worker", parentThreadId: "old", projectId: "elsewhere", isHidden: true, status: "active", title: "Check the cameras" }),
    makeThread({ id: "nested", lifecycleOwnerThreadId: "worker", status: "active" }),
    makeThread({ id: "archived", parentThreadId: "new", isArchived: true, status: "active" }),
    makeThread({ id: "unrelated", projectId: "home", status: "active" }),
  ]);
  expect(rows[0]).toMatchObject({ state: "working", threadId: "worker", text: "Check the cameras", workers: 2, more: 1 });
});

it("routes a worker approval separately while another worker keeps running", () => {
  const [row] = crewActivity([bot], [makeThread({ id: "new" }), makeThread({ id: "approval", parentThreadId: "new", hasPendingInteraction: true, status: "active" }), makeThread({ id: "job", parentThreadId: "new", status: "active" })]);
  expect(row).toMatchObject({ state: "working", threadId: "job", workers: 1 });
  expect(row!.pending.map(t => t.id)).toEqual(["approval"]);
});

it("never says quiet when the coordinator is missing or waiting for its machine", () => {
  expect(crewActivity([bot], [])[0]?.state).toBe("unavailable");
  expect(crewActivity([bot], [makeThread({ id: "new", status: "active", runtimeStatus: "waiting-for-host" })])[0]?.state).toBe("waiting");
  expect(crewActivity([{ ...bot, rollover: "handoff" }], [makeThread({ id: "new" })])[0]?.state).toBe("handover");
});

it("clears activity when the actual runtime settles, without importing a task or reading prose", () => {
  const job = makeThread({ id: "job", parentThreadId: "new", status: "active" });
  expect(crewActivity([bot], [makeThread({ id: "new" }), job])[0]?.state).toBe("working");
  expect(crewActivity([bot], [makeThread({ id: "new" }), { ...job, status: "idle", runtimeStatus: "idle" }])[0]?.state).toBe("idle");
});
