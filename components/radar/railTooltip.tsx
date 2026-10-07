import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type RailTip = {
  key: string;
  botKey?: string;
  label: string;
  shortcut: string | null;
  hint: string | null;
  Accessory: ComponentType | null;
  top: number;
  left: number;
};

/**
 * Hover/focus tooltip for the icon-only rail. The native `title` is slow and
 * can't show the shortcut as a key cap, so this draws its own: label, key
 * cap, panel accessory and a one-line hint, beside the hovered control.
 */
export function RailTooltip({ tip }: { tip: RailTip }) {
  const top = Math.max(8, Math.min(tip.top, window.innerHeight - 56));
  return createPortal(
    <div
      role="tooltip"
      className="radar-rail-tip"
      style={{ top, left: tip.left }}
    >
      <div className="radar-rail-tip-row">
        <span className="radar-rail-tip-label">{tip.label}</span>
        {tip.Accessory ? (
          <span className="radar-rail-tip-accessory">
            <tip.Accessory />
          </span>
        ) : null}
        {tip.shortcut ? <kbd className="radar-kbd">{tip.shortcut}</kbd> : null}
      </div>
      {tip.hint ? <div className="radar-rail-tip-hint">{tip.hint}</div> : null}
    </div>,
    document.body,
  );
}

/**
 * Roving focus for the rail: arrow keys step between enabled controls,
 * Home/End jump to the ends. Tab still leaves the rail as a whole.
 */
export function moveRailFocus(event: ReactKeyboardEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const step =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : event.key === "Home"
          ? -Infinity
          : event.key === "End"
            ? Infinity
            : 0;
  if (step === 0) return;
  const buttons = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  );
  const index = buttons.indexOf(target);
  if (index === -1) return;
  const next =
    step === -Infinity
      ? 0
      : step === Infinity
        ? buttons.length - 1
        : (index + step + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
}
