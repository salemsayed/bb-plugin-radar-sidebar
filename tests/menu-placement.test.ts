import assert from "node:assert/strict";
import { test } from "node:test";
import { MENU_MAX_HEIGHT, menuPlacement } from "../components/radar/menuPlacement";

test("a menu with room below opens downward", () => {
  assert.deepEqual(menuPlacement({ top: 100, bottom: 144, viewport: 900, height: 300 }), { up: false, maxHeight: MENU_MAX_HEIGHT });
});

test("a menu at the bottom of a phone sheet opens upward", () => {
  assert.deepEqual(menuPlacement({ top: 700, bottom: 744, viewport: 844, height: 420 }), { up: true, maxHeight: MENU_MAX_HEIGHT });
});

test("a menu that fits nowhere takes the larger side and scrolls", () => {
  assert.deepEqual(menuPlacement({ top: 200, bottom: 244, viewport: 500, height: 420 }), { up: false, maxHeight: 242 });
  assert.deepEqual(menuPlacement({ top: 300, bottom: 344, viewport: 500, height: 420 }), { up: true, maxHeight: 286 });
});
