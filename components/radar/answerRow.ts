const watched = new WeakMap<HTMLElement, ResizeObserver>();
let canvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * 7;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

function chrome(button: HTMLElement): number {
  const style = getComputedStyle(button);
  return ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((sum, key) => sum + (Number.parseFloat(style[key as "paddingLeft"]) || 0), 0);
}

function natural(group: HTMLElement, buttons: HTMLElement[]): number {
  const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
  group.setAttribute("data-layout", "measure");
  const sum = buttons.reduce((total, button) => total + button.getBoundingClientRect().width, 0) + gap * (buttons.length - 1);
  group.removeAttribute("data-layout");
  return sum;
}

function place(group: HTMLElement) {
  const buttons = [...group.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "BUTTON");
  group.removeAttribute("data-layout");
  group.removeAttribute("data-tight");
  if (buttons.length < 2 || !group.clientWidth) return;
  const room = group.clientWidth + 0.5;
  if (natural(group, buttons) <= room) { group.setAttribute("data-layout", "row"); return; }
  if (buttons.length >= 3) {
    group.setAttribute("data-tight", "");
    if (natural(group, buttons) <= room) { group.setAttribute("data-layout", "row"); return; }
    group.removeAttribute("data-tight");
  }
  if (share(group, buttons, buttons.length)) { group.setAttribute("data-layout", "share"); return; }
  if (buttons.length >= 3 && share(group, buttons, 2)) { group.setAttribute("data-layout", "pairs"); return; }
  group.setAttribute("data-layout", "stack");
}

function share(group: HTMLElement, buttons: HTMLElement[], columns: number): boolean {
  const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
  const each = (group.clientWidth - gap * (columns - 1)) / columns;
  const lines = matchMedia("(pointer: coarse)").matches ? 3 : 2;
  return buttons.every(button => {
    const label = button.querySelector<HTMLElement>(".radar-answer-text") ?? button;
    const style = getComputedStyle(label);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const inner = each - chrome(button);
    const parts = [...label.childNodes].map(node => node.textContent ?? "");
    const runs = [...button.querySelectorAll<HTMLElement>(".radar-rtl-run")].map(run => textWidth(run.textContent ?? "", font));
    const words = (button.textContent ?? "").split(/\s+/).filter(Boolean).map(word => textWidth(word, font));
    return textWidth(parts.join(" ").trim(), font) <= inner * lines * 0.92 && Math.max(0, ...words, ...runs) <= inner;
  });
}

export function answerRow(group: HTMLElement | null) {
  if (!group) return;
  place(group);
  if (watched.has(group)) return;
  let width = group.clientWidth;
  const observer = new ResizeObserver(() => { if (Math.abs(group.clientWidth - width) < 1) return; width = group.clientWidth; place(group); });
  observer.observe(group);
  watched.set(group, observer);
  void document.fonts?.ready.then(() => place(group));
}
