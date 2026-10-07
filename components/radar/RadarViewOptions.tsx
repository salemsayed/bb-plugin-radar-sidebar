import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * One button beside the search field that opens every list setting (status,
 * lifecycle, grouping, density) in a panel under the header, so the header
 * itself stays a single row. The panel stays open while settings change and
 * closes on an outside tap, Escape from inside it, or the button again.
 */
export function RadarViewOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="radar-view-options"
      onKeyDown={(event) => {
        // Stopped here, so the list's own Escape (clear the search) waits
        // for the next press.
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label="View options"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Filter, group and rows"
        className={cn("radar-view-button", open && "radar-view-button-open")}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="FilterHorizontal" aria-hidden="true" />
      </button>
      {open ? (
        <div role="dialog" aria-label="View options" className="radar-view-panel">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function RadarViewSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="radar-view-section">
      <span className="radar-view-label">{label}</span>
      <div className="radar-view-controls">{children}</div>
    </div>
  );
}
