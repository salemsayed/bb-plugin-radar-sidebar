import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { bringBack, dismissToast, type NotNowToast } from "@/lib/notNow";
import { Isolated } from "./Isolated";

const GAP = 12;

function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function placement(): CSSProperties {
  const sidebar = document.querySelector<HTMLElement>('[data-testid="nav-rail-sidebar-body"]')?.getBoundingClientRect();
  const wide = window.innerWidth >= 768;
  if (wide && sidebar && sidebar.width > 0 && sidebar.right + 260 < window.innerWidth) return { left: `${Math.round(sidebar.right + GAP)}px`, bottom: `calc(${GAP}px + env(safe-area-inset-bottom, 0px))` };
  const footer = Array.from(document.querySelectorAll<HTMLElement>('button[aria-label^="Settings"], #sidebar-updates-badge-bb')).map(node => node.getBoundingClientRect()).filter(box => box.height > 0 && box.top > window.innerHeight / 2);
  const top = footer.length ? Math.min(...footer.map(box => box.top)) : window.innerHeight;
  return { left: `${GAP}px`, bottom: `${Math.round(window.innerHeight - top + 8)}px` };
}

export function NotNowToastView({ toast, scope }: { toast: NotNowToast | null; scope?: string }) {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => { if (toast) setStyle(placement()); }, [toast?.key, toast?.error]);
  useEffect(() => {
    if (!toast) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { dismissToast(); return; }
      if (!toast.error && !toast.busy && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && !editable(event.target)) {
        event.preventDefault();
        void bringBack(toast.key, toast.label);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);
  if (!toast) return null;
  return createPortal(<div className="radar-later-toast" data-bb-plugin={scope} role="status" aria-live="polite" data-error={toast.error ? "" : undefined} style={style}>
    <Icon name={toast.error ? "AlertCircle" : "Clock"} aria-hidden="true" />
    <span className="radar-later-toast-text" dir="auto">{toast.error ?? <>Moved to Later: <Isolated text={toast.label} /><span className="radar-later-toast-hint">. Press Control Z to undo, Escape to dismiss.</span></>}</span>
    {toast.error ? null : <button type="button" disabled={toast.busy} aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)" onClick={() => void bringBack(toast.key, toast.label)}>Undo</button>}
    <button type="button" className="radar-later-toast-close" aria-label="Dismiss" aria-keyshortcuts="Escape" title="Dismiss (Esc)" onClick={dismissToast}><Icon name="X" aria-hidden="true" /></button>
  </div>, document.body);
}
