export type HostScroll = {
  deferred: number;
  deferPolicy?: string;
  touching?: boolean;
  flushDeferred(): void;
  reconcile(): void;
  getScrollElement(): HTMLElement | null;
};

type Hook = { memoizedState?: unknown; next?: Hook | null };
type Fiber = { memoizedState?: unknown; return?: Fiber | null };

const cache = new WeakMap<HTMLElement, HostScroll | null>();

function isHostScroll(value: unknown, scroller: HTMLElement): value is HostScroll {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HostScroll>;
  if (typeof candidate.flushDeferred !== "function" || typeof candidate.reconcile !== "function" || typeof candidate.getScrollElement !== "function" || typeof candidate.deferred !== "number") return false;
  try { return candidate.getScrollElement() === scroller; } catch { return false; }
}

export function hostSettlesOverscroll(scroller: HTMLElement) {
  return hostScrollOf(scroller)?.deferPolicy === "overscroll";
}

export function hostScrollOf(scroller: HTMLElement): HostScroll | null {
  const known = cache.get(scroller);
  if (known && isHostScroll(known, scroller)) return known;
  if (known === null) return null;
  let found: HostScroll | null = null;
  try {
    const key = Object.keys(scroller).find(name => name.startsWith("__reactFiber$"));
    let fiber = key ? (scroller as unknown as Record<string, Fiber | undefined>)[key] ?? null : null;
    for (let depth = 0; fiber && depth < 40 && !found; fiber = fiber.return ?? null, depth++) {
      let hook = fiber.memoizedState as Hook | null | undefined;
      for (let index = 0; hook && typeof hook === "object" && "next" in hook && index < 80; hook = hook.next, index++) {
        if (isHostScroll(hook.memoizedState, scroller)) { found = hook.memoizedState; break; }
      }
    }
  } catch { found = null; }
  cache.set(scroller, found);
  return found;
}
