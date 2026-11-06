const watched = new WeakMap<HTMLElement, ResizeObserver>();
let canvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * 7;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

function place(group: HTMLElement) {
  const buttons = [...group.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "BUTTON");
  if (buttons.length !== 2 || !group.clientWidth) { group.removeAttribute("data-side"); return; }
  const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
  const half = (group.clientWidth - gap) / 2;
  const fits = buttons.every(button => {
    const style = getComputedStyle(button);
    const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((sum, key) => sum + (Number.parseFloat(style[key as "paddingLeft"]) || 0), 0);
    return textWidth((button.textContent ?? "").replace(/\s+/g, " ").trim(), `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`) + chrome + 2 <= half;
  });
  group.toggleAttribute("data-side", fits);
}

export function answerSides(group: HTMLElement | null) {
  if (!group) return;
  place(group);
  if (watched.has(group)) return;
  const observer = new ResizeObserver(() => place(group));
  observer.observe(group);
  watched.set(group, observer);
  void document.fonts?.ready.then(() => place(group));
}
