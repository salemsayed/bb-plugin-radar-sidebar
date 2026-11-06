const watched = new WeakMap<HTMLElement, ResizeObserver>();
let canvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return text.length * 7;
  context.font = font;
  return Math.ceil(context.measureText(text).width);
}

function fitsIn(button: HTMLElement, room: number): boolean {
  const style = getComputedStyle(button);
  const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((sum, key) => sum + (Number.parseFloat(style[key as "paddingLeft"]) || 0), 0);
  return textWidth((button.textContent ?? "").replace(/\s+/g, " ").trim(), `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`) + chrome + 2 <= room;
}

const TRIO_ROOM = 104;

function widthOf(button: HTMLElement): number {
  const style = getComputedStyle(button);
  const chrome = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((sum, key) => sum + (Number.parseFloat(style[key as "paddingLeft"]) || 0), 0);
  return textWidth((button.textContent ?? "").replace(/\s+/g, " ").trim(), `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`) + chrome + 2;
}

function trio(group: HTMLElement, buttons: HTMLElement[], gap: number): boolean {
  if (buttons.length !== 3) return false;
  const widths = buttons.map(widthOf);
  const long = widths.indexOf(Math.max(...widths));
  const room = group.clientWidth - 2 * gap - widths.reduce((sum, width, i) => i === long ? sum : sum + width, 0);
  if (room < TRIO_ROOM || room * 2 < widths[long]! + 24) return false;
  group.style.gridTemplateColumns = buttons.map((_, i) => i === long ? "minmax(0, 1fr)" : "max-content").join(" ");
  group.setAttribute("data-trio", "");
  return true;
}

function place(group: HTMLElement) {
  const buttons = [...group.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "BUTTON");
  for (const button of buttons) button.removeAttribute("data-wide");
  group.removeAttribute("data-trio");
  group.style.gridTemplateColumns = "";
  if (buttons.length < 2 || buttons.length > 3 || !group.clientWidth) { group.removeAttribute("data-side"); return; }
  const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
  const half = (group.clientWidth - gap) / 2;
  const fits = buttons.map(button => fitsIn(button, half));
  if (buttons.length === 2) { group.toggleAttribute("data-side", fits.every(Boolean)); return; }
  if (!fits.every(Boolean) && trio(group, buttons, gap)) { group.removeAttribute("data-side"); return; }
  const wide = fits.every(Boolean) ? 2 : fits.filter(fit => !fit).length === 1 && (!fits[0] || !fits[2]) ? fits.indexOf(false) : -1;
  group.toggleAttribute("data-side", wide >= 0);
  if (wide >= 0) buttons[wide]!.setAttribute("data-wide", "");
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
