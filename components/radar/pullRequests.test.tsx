// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeProject, makeThread } from "./fixtures";

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;

/** Only what the list touches; the cast keeps the harness's exhaustive fake tree out of the fixture. */
const sdk: Record<string, unknown> = {
  threads: { list: async () => [], defaultExecutionOptions: async () => null, context: async () => ({ usage: null }) },
  providers: { models: async () => ({ models: [] }) },
  system: { uiPreferences: { list: async () => ({ preferences: {} }), set: async () => ({ revision: 1, value: [] }) } },
};

function renderWithPullRequests(pullRequests: (input: unknown) => unknown) {
  return renderSlot(threadList, { activeThreadId: null, activeProjectId: "proj_a", isCompactViewport: false, onNavigate: () => {}, searchQuery: "" }, {
    sdk,
    rpc: { pullRequests },
    sidebarThreads: { status: "ready", threads: [makeThread({ id: "t1", environment: { id: "env_t1", name: null, branchName: "fix-queue", path: null, isWorktree: false, providerId: "project-checkout", workspaceDisplayKind: null } })], projects: [makeProject({ id: "proj_a" })], sections: [], experimental_archived: null },
  });
}

describe("row pull requests (GitHub PR Status plugin)", () => {
  afterEach(cleanup);

  it("asks for the row's environment and shows its pull request", async () => {
    const asked: unknown[] = [];
    renderWithPullRequests(input => {
      asked.push(input);
      return { env_t1: { outcome: "available", pullRequest: { number: 42, title: "Fix the queue", url: "https://github.com/o/r/pull/42", state: "open", attention: "none", checks: { state: "passing" } } } };
    });
    expect(await screen.findByRole("button", { name: "Open pull request 42: Fix the queue" })).toBeTruthy();
    expect(asked).toContainEqual({ keys: ["env_t1"] });
  });

  it("shows nothing when the environment has no pull request", async () => {
    let asked = false;
    renderWithPullRequests(() => { asked = true; return { env_t1: { outcome: "absent" } }; });
    await expect.poll(() => asked).toBe(true);
    expect(screen.queryByRole("button", { name: /Open pull request/ })).toBeNull();
  });
});
