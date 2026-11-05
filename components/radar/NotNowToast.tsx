import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { bringBack, dismissToast, type NotNowToast } from "@/lib/notNow";
import { Isolated } from "./Isolated";

export function NotNowToastView({ toast, scope }: { toast: NotNowToast | null; scope?: string }) {
  if (!toast) return null;
  return createPortal(<div className="radar-later-toast" data-bb-plugin={scope} role="status" aria-live="polite" data-error={toast.error ? "" : undefined}>
    <Icon name={toast.error ? "AlertCircle" : "Clock"} aria-hidden="true" />
    <span className="radar-later-toast-text" dir="auto">{toast.error ?? <>Moved to Later: <Isolated text={toast.label} /></>}</span>
    {toast.error ? null : <button type="button" disabled={toast.busy} onClick={() => void bringBack(toast.key, toast.label)}>Undo</button>}
    <button type="button" className="radar-later-toast-close" aria-label="Dismiss" onClick={dismissToast}><Icon name="X" aria-hidden="true" /></button>
  </div>, document.body);
}
