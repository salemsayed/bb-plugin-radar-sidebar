import { settleAskInView } from "./askLanding";
import { newestTimelineSeq } from "./messageRows";
import { dropLinkHold, holdLink } from "./primeScrollRoute";

const WAIT_MS = 15_000;
const FRESH_MS = 4_000;
const STEP_MS = 50;
let request = 0;

export function showMessage(threadId: string, messageSeq: number): void {
  const id = ++request;
  const started = Date.now();
  let rowsAt: number | null = null;
  holdLink(threadId, WAIT_MS);
  const onThread = () => location.pathname.replace(/\/$/, "").endsWith(`/threads/${threadId}`);
  const land = () => {
    history.replaceState(history.state, "", `${location.pathname}${location.search}#msg=${messageSeq}`);
    dropLinkHold(threadId);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    settleAskInView(messageSeq, threadId);
  };
  const tick = () => {
    if (id !== request) return;
    const now = Date.now();
    if (onThread()) {
      const newest = newestTimelineSeq(threadId);
      if (newest > 0 && rowsAt === null) rowsAt = now;
      if (newest >= messageSeq || rowsAt !== null && now - rowsAt >= FRESH_MS || now - started >= WAIT_MS) { land(); return; }
    }
    if (now - started < WAIT_MS) setTimeout(tick, STEP_MS);
    else dropLinkHold(threadId);
  };
  tick();
}
