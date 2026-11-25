import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHIP_HUE_MAX,
  CHIP_HUE_MIN,
  prLabel,
  projectHue,
  sameCollapse,
  statusVisualFor,
  statusWordFor,
  stripLeadingEmoji,
} from "../components/radar/rowViewModel";

test("statusWordFor simplifies live & background indicators to Working while keeping distinct visuals", () => {
  assert.deepEqual(statusWordFor("waiting-for-input"), { text: "Needs you", tone: "radar-tone-warning" });
  assert.deepEqual(statusWordFor("unread-error"), { text: "Failed", tone: "radar-tone-error" });
  assert.deepEqual(statusWordFor("queued-failed"), { text: "Failed", tone: "radar-tone-error" });
  for (const ind of ["runtime", "working-draft", "background-agent", "background-command", "workflow", "goal", "plan-mode"]) {
    assert.deepEqual(statusWordFor(ind), { text: "Working", tone: "radar-tone-running" });
  }
  assert.deepEqual(statusVisualFor("background-agent"), {
    kind: "icon",
    name: "Bot",
    className: "radar-tone-running radar-icon-pulse",
  });
  assert.deepEqual(statusVisualFor("background-command"), {
    kind: "icon",
    name: "Terminal",
    className: "radar-tone-running radar-icon-pulse",
  });
  assert.deepEqual(statusWordFor("queued-waiting"), { text: "Queued", tone: "radar-tone-muted" });
  assert.deepEqual(statusWordFor("unread-success"), { text: "Done", tone: "radar-tone-success" });
  assert.equal(statusWordFor("none"), null);
  assert.equal(statusWordFor("draft"), null);
});

test("stripLeadingEmoji, projectHue, prLabel, and sameCollapse behave deterministically", () => {
  assert.equal(stripLeadingEmoji("🟢 Redemption #138"), "Redemption #138");
  assert.equal(stripLeadingEmoji("🟢"), "🟢");
  const hue = projectHue("proj_abc123");
  assert.ok(hue >= CHIP_HUE_MIN && hue < CHIP_HUE_MAX);
  assert.equal(prLabel("open", "ready_to_merge"), "Ready to merge");
  assert.equal(prLabel("draft", "none"), "Draft");
  assert.equal(
    sameCollapse(
      { collapsed: true, hiddenTotal: 2, hiddenUnread: 1, hiddenLive: false, hiddenNeedsUser: false, hiddenFailed: false, hiddenKids: [{ id: "a", title: "A", dot: null }], onToggle: () => {} },
      { collapsed: true, hiddenTotal: 2, hiddenUnread: 1, hiddenLive: false, hiddenNeedsUser: false, hiddenFailed: false, hiddenKids: [{ id: "a", title: "A", dot: null }], onToggle: () => {} },
    ),
    true,
  );
  assert.equal(
    sameCollapse(
      { collapsed: true, hiddenTotal: 2, hiddenUnread: 1, hiddenLive: false, hiddenNeedsUser: false, hiddenFailed: false, hiddenKids: [], onToggle: () => {} },
      { collapsed: false, hiddenTotal: 2, hiddenUnread: 1, hiddenLive: false, hiddenNeedsUser: false, hiddenFailed: false, hiddenKids: [], onToggle: () => {} },
    ),
    false,
  );
});
