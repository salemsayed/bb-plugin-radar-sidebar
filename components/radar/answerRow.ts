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

function place(group: HTMLElement) {
  const buttons = [...group.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "BUTTON");
  group.removeAttribute("data-layout");
  if (buttons.length < 2 || !group.clientWidth) return;
  const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
  group.setAttribute("data-layout", "measure");
  const natural = buttons.map(button => button.getBoundingClientRect().width);
  group.removeAttribute("data-layout");
  const room = group.clientWidth;
  if (natural.reduce((sum, width) => sum + width, 0) + gap * (buttons.length - 1) <= room + 0.5) { group.setAttribute("data-layout", "row"); return; }
  if (buttons.length === 2) {
    const share = (room - gap) / 2;
    const fits = buttons.every(button => {
      const label = button.querySelector<HTMLElement>(".radar-answer-text") ?? button;
      const style = getComputedStyle(label);
      const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const inner = share - chrome(button);
      const parts = [...label.childNodes].map(node => node.textContent ?? "");
      const runs = [...button.querySelectorAll<HTMLElement>(".radar-rtl-run")].map(run => textWidth(run.textContent ?? "", font));
      const words = (button.textContent ?? "").split(/\s+/).filter(Boolean).map(word => textWidth(word, font));
      const lines = matchMedia("(pointer: coarse)").matches ? 3 : 2;
      return textWidth(parts.join(" ").trim(), font) <= inner * lines * 0.92 && Math.max(0, ...words, ...runs) <= inner;
    });
    if (fits) { group.setAttribute("data-layout", "share"); return; }
  }
  group.setAttribute("data-layout", "flow");
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
