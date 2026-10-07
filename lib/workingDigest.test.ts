import { describe, expect, it } from "vitest";
import { digestTimeline, oneLine, type TimelineRowLike } from "./workingDigest";

const user = (at: number): TimelineRowLike => ({ kind: "conversation", role: "user", text: "Do the thing", startedAt: at });
const said = (at: number, text: string): TimelineRowLike => ({ kind: "conversation", role: "assistant", text, startedAt: at });
const command = (at: number, cmd: string, extra: Partial<TimelineRowLike> = {}): TimelineRowLike => ({
  kind: "work", workKind: "command", command: cmd, status: "completed", exitCode: 0, startedAt: at, completedAt: at + 1,
  presentation: { title: cmd, label: { pending: "Running command", completed: "Ran command" } }, ...extra,
});

describe("digestTimeline", () => {
  it("reads the run's start, latest words, newest step and phase", () => {
    const digest = digestTimeline("t", {
      rows: [
        user(1_000),
        command(2_000, "rg needle src"),
        said(3_000, "**Found it.** Now running the [tests](https://x) to confirm\nthe fix."),
        command(4_000, "npx vitest run", { status: "pending", exitCode: null, completedAt: null }),
      ],
    });
    expect(digest.runningSince).toBe(1_000);
    expect(digest.saying).toBe("Found it. Now running the tests to confirm the fix.");
    expect(digest.doing).toEqual({ label: "Running command", detail: "npx vitest run", pending: true, at: 4_000 });
    expect(digest.phase).toBe("testing");
    expect(digest.steps).toBe(2);
    expect(digest.lastActivityAt).toBe(4_000);
  });

  it("counts failing commands at the end of the run, skipping the pending one", () => {
    const digest = digestTimeline("t", {
      rows: [
        command(1, "npm test", { exitCode: 1 }),
        command(2, "npm ci"),
        command(3, "npm test", { exitCode: 1 }),
        command(4, "npm test", { status: "error", exitCode: null }),
        command(5, "npm test", { status: "pending", exitCode: null, completedAt: null }),
      ],
    });
    expect(digest.failingStreak).toBe(2);
  });

  it("summarises todos, goal, context, background work and a model fallback", () => {
    const digest = digestTimeline("t", {
      rows: [user(1)],
      pendingTodos: { items: [
        { status: "completed", text: "Read the code" },
        { status: "in_progress", text: "Write the **digest**" },
        { status: "pending", text: "Ship it" },
      ] },
      goal: { objective: "Peek into working threads", status: "active" },
      contextWindowUsage: { usedTokens: 10, modelContextWindow: 100, snapshot: { usedTokens: 82_000, contextWindowTokens: 100_000 } },
      activeBackgroundCommands: [{ taskStatus: "running" }, { taskStatus: "completed" }],
      activeWorkflows: [{ taskStatus: "pending" }],
      modelFallback: { fallbackModel: "claude-sonnet-5-5" },
    });
    expect(digest.todos).toEqual({ done: 1, total: 3, current: "Write the digest" });
    expect(digest.goal).toBe("Peek into working threads");
    expect(digest.context).toBeCloseTo(0.82);
    expect(digest.background).toBe(2);
    expect(digest.fallback).toBe("claude-sonnet-5-5");
  });

  it("calls a thought newer than every row thinking, and reads nested turn rows", () => {
    const digest = digestTimeline("t", {
      rows: [{ kind: "turn", startedAt: 1, children: [user(1), { kind: "work", workKind: "fileChange", status: "completed", change: { path: "src/a.ts" }, startedAt: 2 }] }],
      activeThinking: { text: "hmm", updatedAt: 9 },
    });
    expect(digest.phase).toBe("thinking");
    expect(digest.doing).toMatchObject({ label: "Edited", detail: "src/a.ts", pending: false });
    expect(digest.lastActivityAt).toBe(9);
  });

  it("leaves everything empty for a run with no rows yet", () => {
    expect(digestTimeline("t", {})).toMatchObject({
      runningSince: null, lastActivityAt: null, saying: null, doing: null, phase: null, steps: 0, todos: null, context: null,
    });
  });
});

describe("oneLine", () => {
  it("drops code blocks and markdown and truncates on a word-ish boundary", () => {
    expect(oneLine("Run:\n```sh\nrm -rf /\n```\n`npm test` now", 40)).toBe("Run: npm test now");
    expect(oneLine("a".repeat(30), 10)).toBe(`${"a".repeat(9)}…`);
    expect(oneLine('::browser-preview{session="abc"}\nChecking the page now.')).toBe("Checking the page now.");
  });
});
