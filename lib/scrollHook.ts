export type ScrollWrite = { from: number; to: number; own: boolean; via: string; pending?: boolean };
type Listener = (write: ScrollWrite) => void;

const listeners = new WeakMap<HTMLElement, Set<Listener>>();
const hooked = new Set<HTMLElement>();
const notes = new WeakMap<HTMLElement, (from: number, via: string, smooth?: number | null) => void>();
let own = 0;
let intoView: { original: Element["scrollIntoView"]; wrapper: Element["scrollIntoView"] } | null = null;
const gates = new Set<(element: Element) => boolean>();

export function gateIntoView(gate: (element: Element) => boolean) {
  gates.add(gate);
  return () => { gates.delete(gate); };
}

export function ownWrite(write: () => void) {
  own++;
  try { write(); } finally { own--; }
}

function hook(scroller: HTMLElement) {
  const existing = listeners.get(scroller);
  if (existing) return existing;
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  if (!scrollTop?.get || !scrollTop.set) return null;
  const set = new Set<Listener>();
  listeners.set(scroller, set);
  hooked.add(scroller);
  const get = scrollTop.get, put = scrollTop.set;
  const note = (from: number, via: string, smooth?: number | null) => {
    const to = get.call(scroller) as number;
    const pending = smooth !== undefined && Math.abs(to - from) < 0.5;
    if (!pending && Math.abs(to - from) < 0.5) return;
    const write = pending ? { from, to: smooth ?? from, own: own > 0, via: `smooth-${via}`, pending: true } : { from, to, own: own > 0, via };
    for (const listener of [...set]) {
      try { listener(write); } catch {}
    }
  };
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get() { return get.call(scroller); },
    set(value: number) { const from = get.call(scroller) as number; put.call(scroller, value); note(from, "top"); },
  });
  notes.set(scroller, note);
  hookIntoView();
  for (const name of ["scrollTo", "scrollBy"] as const) {
    const original = Element.prototype[name] as (...args: unknown[]) => void;
    Object.defineProperty(scroller, name, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => { const from = get.call(scroller) as number; original.apply(scroller, args); note(from, name, smoothTarget(args, name, from)); },
    });
  }
  return set;
}

function smoothTarget(args: unknown[], name: string, from: number): number | null | undefined {
  const options = args[0];
  if (!options || typeof options !== "object" || (options as ScrollToOptions).behavior !== "smooth") return undefined;
  const top = (options as ScrollToOptions).top;
  if (typeof top !== "number") return null;
  return name === "scrollBy" ? from + top : top;
}

function hookIntoView() {
  if (intoView) return;
  const original = Element.prototype.scrollIntoView;
  if (typeof original !== "function") return;
  const wrapper = function (this: Element, ...args: unknown[]) {
    for (const gate of gates) {
      try { if (gate(this)) return; } catch {}
    }
    const around: { scroller: HTMLElement; from: number }[] = [];
    for (const scroller of hooked) if (scroller !== this && scroller.contains(this)) around.push({ scroller, from: scroller.scrollTop });
    try { return (original as (...a: unknown[]) => void).apply(this, args); }
    finally { for (const { scroller, from } of around) notes.get(scroller)?.(from, "intoView", smoothTarget(args, "intoView", from)); }
  } as Element["scrollIntoView"];
  Element.prototype.scrollIntoView = wrapper;
  intoView = { original, wrapper };
}

export function onScrollWrite(scroller: HTMLElement, listener: Listener) {
  const set = hook(scroller);
  if (!set) return () => {};
  set.add(listener);
  return () => { set.delete(listener); };
}

export function releaseScrollHooks() {
  for (const scroller of hooked) {
    const element = scroller as unknown as Record<string, unknown>;
    delete element.scrollTop;
    delete element.scrollTo;
    delete element.scrollBy;
    listeners.delete(scroller);
    notes.delete(scroller);
  }
  hooked.clear();
  gates.clear();
  if (intoView && Element.prototype.scrollIntoView === intoView.wrapper) Element.prototype.scrollIntoView = intoView.original;
  intoView = null;
}
