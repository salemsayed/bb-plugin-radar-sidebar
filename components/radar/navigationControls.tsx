import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  experimental_SidebarNavigationIcon as SidebarNavigationIcon,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
} from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { moveRailFocus } from "./railTooltip";

export function hintFor(item: ExperimentalSidebarNavigationItem): string {
  const parts = [item.label];
  if (item.shortcut) parts.push(`(${item.shortcut.label})`);
  return parts.join(" ");
}

export function RowIcon({
  item,
  className,
}: {
  item: ExperimentalSidebarNavigationItem;
  className?: string;
}) {
  return <SidebarNavigationIcon icon={item.icon} className={className} />;
}

export function NavigationButton({
  item,
  isActive,
  onActivate,
  className,
  title,
  onContextMenu,
  splitActivation = "sidebar",
  onSplitDragStart,
  children,
  ...rest
}: {
  item: ExperimentalSidebarNavigationItem;
  isActive: boolean;
  onActivate: (
    item: ExperimentalSidebarNavigationItem,
    openInSplit: boolean,
  ) => void;
  className: string;
  /** Pass `null` to rely on a custom tooltip instead of the native one. */
  title?: string | null;
  onContextMenu?: React.MouseEventHandler<HTMLButtonElement>;
  splitActivation?: "distance" | "sidebar";
  onSplitDragStart?: () => void;
  children: React.ReactNode;
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "onClick" | "children"
>) {
  const split = experimental_useSidebarNavigationSplit(
    item.id,
    splitActivation === "distance"
      ? { activation: "distance", onDragStart: onSplitDragStart }
      : undefined,
  );

  return (
    <button
      type="button"
      disabled={item.isDisabled || item.isLoading}
      aria-label={hintFor(item)}
      aria-current={isActive ? "page" : undefined}
      aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
      title={title === null ? undefined : (title ?? hintFor(item))}
      {...rest}
      {...split.splitProps}
      onClick={(event) =>
        onActivate(item, event.altKey || event.ctrlKey || event.metaKey)
      }
      onContextMenu={onContextMenu}
      className={className}
    >
      {children}
    </button>
  );
}

/** A sidebar action listed under the destinations in the More popover. */
export interface MoreAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

/**
 * The "More" overflow popover: fixed to the side of the trigger (like BB's
 * stock popover), scrollable, closes on selection, Escape, resize, or an
 * outside pointer-down. All listeners are removed on unmount.
 */
export function MorePopover({
  x,
  y,
  items,
  activeItemId,
  onActivate,
  onOpenMenu,
  onClose,
  triggerRef,
  actions = [],
}: {
  x: number;
  y: number;
  items: readonly ExperimentalSidebarNavigationItem[];
  activeItemId: string | null;
  onActivate: (
    item: ExperimentalSidebarNavigationItem,
    openInSplit: boolean,
  ) => void;
  onOpenMenu: (
    clientX: number,
    clientY: number,
    item: ExperimentalSidebarNavigationItem,
  ) => void;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /** Rarely used sidebar controls, kept here instead of on the rail. */
  actions?: readonly MoreAction[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = 248;
  const estimatedHeight = Math.min(
    (items.length + actions.length) * 34 + 64,
    420,
  );
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8));
  const top = Math.max(
    8,
    Math.min(y, window.innerHeight - estimatedHeight - 8),
  );

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
    const firstItem = ref.current?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    (firstItem ?? ref.current)?.focus();
    return () => {
      triggerRef.current?.focus();
    };
  }, [triggerRef]);

  return createPortal(
    <div
      ref={ref}
      role="group"
      tabIndex={-1}
      aria-label="More navigation"
      className="radar-nav-more-pop"
      style={{ left, top, width }}
      onKeyDown={moveRailFocus}
    >
      <div className="radar-nav-more-head">
        <span className="radar-nav-more-title">More</span>
        {items.length > 0 ? (
          <span className="radar-nav-more-hint">Right-click to arrange</span>
        ) : null}
      </div>
      <div className="radar-nav-more-list">
        {items.map((item) => {
          const isActive = item.id === activeItemId;
          const Accessory = item.experimental_Accessory;
          return (
            <NavigationButton
              key={item.id}
              item={item}
              isActive={isActive}
              onActivate={onActivate}
              title={`${hintFor(item)} — Option-click opens in a split`}
              splitActivation="distance"
              onSplitDragStart={onClose}
              onContextMenu={(event) => {
                event.preventDefault();
                onOpenMenu(event.clientX, event.clientY, item);
              }}
              className={cn(
                "radar-nav-row",
                isActive && "radar-nav-row-active",
              )}
            >
              <RowIcon item={item} className="radar-nav-icon" />
              <span className="radar-nav-label">{item.label}</span>
              {Accessory ? (
                <span className="radar-nav-accessory">
                  <Accessory />
                </span>
              ) : null}
              {item.shortcut ? (
                <kbd className="radar-kbd">{item.shortcut.label}</kbd>
              ) : null}
            </NavigationButton>
          );
        })}
      </div>
      {actions.length > 0 ? (
        <div
          className={cn(
            "radar-nav-more-actions",
            items.length > 0 && "radar-nav-more-actions-split",
          )}
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="radar-nav-row"
              onClick={action.onSelect}
            >
              <span className="radar-nav-icon" aria-hidden="true">
                {action.icon}
              </span>
              <span className="radar-nav-label">{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
