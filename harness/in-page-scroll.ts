import { rememberScroll, chatScroller, messageAnchors } from "../lib/scrollController";

const match = location.pathname.match(/\/threads\/([^/]+)/);
if (match?.[1] === "thr_yaa3n3kk73") {
  const threadId = match[1];
  const key = `radar-test-position:${innerWidth < 700 ? "phone" : "desktop"}`;
  const cached = JSON.parse(localStorage.getItem(key) ?? "null");
  const dispose = rememberScroll(threadId, {
    cached,
    loadAnchor: seq => { history.replaceState(null, "", `${location.pathname}#msg=${seq}`); window.dispatchEvent(new PopStateEvent("popstate")); },
    load: async () => { await new Promise(resolve => setTimeout(resolve, 40)); return cached; },
    save: position => localStorage.setItem(key, JSON.stringify(position)),
  });
  window.addEventListener("pagehide", dispose, { once: true });
  const frames: unknown[] = [];
  const started = performance.now();
  function sample() {
    const box = chatScroller(threadId);
    const anchor = messageAnchors(threadId).find(e => Number(e.dataset.notificationMessage) === cached?.messageSeq);
    frames.push({ ms: Math.round(performance.now() - started), container: !!box, visible: box ? getComputedStyle(box).visibility : null, offset: box && anchor ? anchor.getBoundingClientRect().top - box.getBoundingClientRect().top : null, expected: cached?.offset });
    if (performance.now() - started < 6000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  Object.assign(window, { radarScrollHarness: { frames, dispose, key } });
}
