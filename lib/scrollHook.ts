export type ScrollWrite = { from: number; to: number; own: boolean; via: string };
type Listener = (write: ScrollWrite) => void;

const listeners = new WeakMap<HTMLElement, Set<Listener>>();
const hooked = new Set<HTMLElement>();
let own = 0;

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
  const note = (from: number, via: string) => {
    const to = get.call(scroller) as number;
    if (Math.abs(to - from) < 0.5) return;
    const write = { from, to, own: own > 0, via };
    for (const listener of [...set]) {
      try { listener(write); } catch {}
    }
  };
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get() { return get.call(scroller); },
    set(value: number) { const from = get.call(scroller) as number; put.call(scroller, value); note(from, "top"); },
  });
  for (const name of ["scrollTo", "scrollBy"] as const) {
    const original = Element.prototype[name] as (...args: unknown[]) => void;
    Object.defineProperty(scroller, name, {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => { const from = get.call(scroller) as number; original.apply(scroller, args); note(from, name); },
    });
  }
  return set;
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
  }
  hooked.clear();
}
