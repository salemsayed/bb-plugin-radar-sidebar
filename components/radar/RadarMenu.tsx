import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type RadarMenuItem =
  | {
      kind: "item";
      id: string;
      label: string;
      icon?: string;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      /** Hover text, used to say why a disabled item cannot act. */
      title?: string;
    }
  | { kind: "separator" }
  | { kind: "header"; label: string };

/**
 * A small viewport-fixed context menu. Rendered with `position: fixed` from
 * client coordinates, clamped into the window. It closes on outside
 * pointer-down, Escape, scroll, or resize, and every listener is removed on
 * unmount.
 */
export function RadarMenu({
  x,
  y,
  items,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  items: RadarMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const width = 248;
  const estimatedHeight = Math.min(items.length * 32 + 16, 420);
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - estimatedHeight - 8));

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = (event: Event) => {
      if (ref.current && ref.current.contains(event.target as Node)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const moveFocus = (direction: 1 | -1 | "first" | "last") => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-menu-item]:not(:disabled)',
      ) ?? [],
    );
    if (buttons.length === 0) return;
    if (direction === "first" || direction === "last") {
      buttons[direction === "first" ? 0 : buttons.length - 1]?.focus();
      return;
    }
    const active = document.activeElement;
    const index = buttons.findIndex((button) => button === active);
    const next =
      index === -1
        ? direction === 1
          ? 0
          : buttons.length - 1
        : (index + direction + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label="Thread actions"
      className="radar-menu"
      style={{ left, top, width }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveFocus(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveFocus(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          moveFocus("first");
        } else if (event.key === "End") {
          event.preventDefault();
          moveFocus("last");
        }
      }}
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={`sep-${index}`} role="separator" className="radar-menu-separator" />
          );
        }
        if (item.kind === "header") {
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={`head-${index}`} className="radar-menu-header">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            data-menu-item=""
            disabled={item.disabled}
            title={item.title}
            className={cn(
              "radar-menu-item",
              item.danger && "radar-menu-item-danger",
            )}
            onClick={() => onSelect(item.id)}
          >
            {item.icon ? (
              <Icon name={item.icon} aria-hidden="true" className="radar-menu-icon" />
            ) : (
              <span className="radar-menu-icon" aria-hidden="true" />
            )}
            <span className="radar-menu-label">{item.label}</span>
            {item.checked ? (
              <Icon name="Check" aria-hidden="true" className="radar-menu-check" />
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
