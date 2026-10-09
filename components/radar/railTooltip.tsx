import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type RailTip = {
  key: string;
  botKey: string;
  top: number;
  left: number;
};

/**
 * Arrow-key focus for bot shortcuts: arrow keys step between enabled controls,
 * Home/End jump to the ends. Tab keeps the normal button order.
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
