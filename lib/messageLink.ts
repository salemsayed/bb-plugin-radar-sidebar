import { settleAskInView } from "./askLanding";

const WAIT_MS = 15_000;
let request = 0;
const STEP_MS = 50;

export function showMessage(threadId: string, messageSeq: number): void {
  const id = ++request;
  const started = Date.now();
  const onThread = () => location.pathname.replace(/\/$/, "").endsWith(`/threads/${threadId}`);
  const tick = () => {
    if (id !== request) return;
    if (onThread()) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}#msg=${messageSeq}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      settleAskInView(messageSeq, threadId);
      return;
    }
    if (Date.now() - started < WAIT_MS) setTimeout(tick, STEP_MS);
  };
  tick();
}
