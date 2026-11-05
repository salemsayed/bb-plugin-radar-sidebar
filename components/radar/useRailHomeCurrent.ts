import { useEffect } from "react";

const HOME = '[data-sidebar-navigation-placement="rail"] button[aria-label="Home"]';
const SAVED = "data-radar-current";

function restore() {
  const home = document.querySelector<HTMLElement>(`${HOME}[${SAVED}]`);
  if (!home) return;
  if (!home.hasAttribute("aria-current")) home.setAttribute("aria-current", home.getAttribute(SAVED) || "page");
  home.removeAttribute(SAVED);
}

export function useRailHomeCurrent(inThread: boolean) {
  useEffect(() => {
    if (!inThread) { restore(); return; }
    const apply = () => {
      const home = document.querySelector<HTMLElement>(HOME);
      if (home?.getAttribute("aria-current") !== "page") return;
      home.setAttribute(SAVED, "page");
      home.removeAttribute("aria-current");
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
    const timer = setInterval(apply, 1500);
    return () => { observer.disconnect(); clearInterval(timer); restore(); };
  }, [inThread]);
}
