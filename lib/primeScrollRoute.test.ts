import { afterEach, expect, it } from "vitest";
import { primeScrollRoute } from "./primeScrollRoute";
afterEach(() => { localStorage.clear(); sessionStorage.clear(); history.replaceState(null, "", "/"); });
it("leaves a cold document on the native latest view instead of seeding a message link", () => {
  history.replaceState(null, "", "/threads/one");
  localStorage.setItem("radar-scroll:one", JSON.stringify({ atBottom: false, messageSeq: 42, offset: -30 }));
  primeScrollRoute();
  expect(location.hash).toBe("");
});
