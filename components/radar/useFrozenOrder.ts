import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

interface Ordered {
  id: string;
}

export interface OrderGroup<T extends Ordered> {
  id: string;
  roots: T[];
}

/**
 * Everything whose order the list renders: groups per region (needs-you lane,
 * bots, pinned, the main groups, the working drawer) and each family's
 * children.
 */
export interface OrderLayout<T extends Ordered, G extends OrderGroup<T>> {
  regions: G[][];
  children: Map<string, T[]>;
}

function sameIds<T extends Ordered>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index]!.id);
}

/**
 * The latest layout in the previous layout's order. Rows keep their group and
 * position and show their latest data; rows that are new to a group's place
 * are appended at its end, groups new to a region after that region's groups,
 * and rows that left the list are dropped. `regroup` rebuilds a group's
 * counts for the roots it now holds.
 */
export function freezeLayout<T extends Ordered, G extends OrderGroup<T>>(
  previous: OrderLayout<T, G>,
  latest: OrderLayout<T, G>,
  regroup: (group: G, roots: T[]) => G,
): OrderLayout<T, G> {
  const latestGroup = new Map<string, G>();
  const latestRoot = new Map<string, { thread: T; groupId: string }>();
  for (const region of latest.regions) {
    for (const group of region) {
      latestGroup.set(group.id, group);
      for (const root of group.roots) latestRoot.set(root.id, { thread: root, groupId: group.id });
    }
  }
  const held = new Set<string>();
  for (const region of previous.regions) {
    for (const group of region) {
      for (const root of group.roots) if (latestRoot.has(root.id)) held.add(root.id);
    }
  }
  // Map order is the latest order, so arrivals keep their relative order.
  const arrivals = new Map<string, T[]>();
  for (const [id, { thread, groupId }] of latestRoot) {
    if (held.has(id)) continue;
    const list = arrivals.get(groupId);
    if (list) list.push(thread);
    else arrivals.set(groupId, [thread]);
  }

  const settle = (base: G, roots: T[]): G =>
    latestGroup.get(base.id) === base && sameIds(roots, base.roots) ? base : regroup(base, roots);

  const regions = latest.regions.map((region, index) => {
    const prior = previous.regions[index] ?? [];
    const priorIds = new Set(prior.map((group) => group.id));
    const out: G[] = [];
    for (const group of prior) {
      const roots = [
        ...group.roots.filter((root) => held.has(root.id)).map((root) => latestRoot.get(root.id)!.thread),
        ...(arrivals.get(group.id) ?? []),
      ];
      const current = latestGroup.get(group.id);
      if (roots.length === 0 && !current) continue;
      out.push(settle(current ?? group, roots));
    }
    for (const group of region) {
      if (priorIds.has(group.id)) continue;
      const roots = arrivals.get(group.id) ?? [];
      // Every member is still shown where it was: nothing new to place.
      if (roots.length === 0 && group.roots.length > 0) continue;
      out.push(settle(group, roots));
    }
    return out;
  });

  const children = new Map<string, T[]>();
  for (const [parentId, kids] of latest.children) {
    const prior = previous.children.get(parentId);
    if (!prior) {
      children.set(parentId, kids);
      continue;
    }
    const byId = new Map(kids.map((kid) => [kid.id, kid]));
    const kept = prior.filter((kid) => byId.has(kid.id)).map((kid) => byId.get(kid.id)!);
    const keptIds = new Set(kept.map((kid) => kid.id));
    const next = [...kept, ...kids.filter((kid) => !keptIds.has(kid.id))];
    children.set(parentId, sameIds(next, kids) ? kids : next);
  }
  return { regions, children };
}

/**
 * Hold the rendered order while `frozen`, so rows never move under the
 * pointer or a finger. Data still updates in place. A `resetKey` change (a new
 * grouping, filter or user-chosen order) shows the latest order at once.
 */
export function useFrozenOrder<T extends Ordered, G extends OrderGroup<T>>(
  latest: OrderLayout<T, G>,
  frozen: boolean,
  regroup: (group: G, roots: T[]) => G,
  resetKey: string,
): OrderLayout<T, G> {
  const rendered = useRef<{ layout: OrderLayout<T, G>; key: string } | null>(null);
  const layout = useMemo(() => {
    const previous = rendered.current;
    if (!frozen || !previous || previous.key !== resetKey) return latest;
    return freezeLayout(previous.layout, latest, regroup);
  }, [latest, frozen, regroup, resetKey]);
  useLayoutEffect(() => {
    rendered.current = { layout, key: resetKey };
  }, [layout, resetKey]);
  return layout;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Whether the list is being pointed at or touched. Hover (mouse or pen) holds
 * the order; a touch or scroll holds it until `touchHoldMs` after it ends.
 * Once nothing holds it, the order commits after `idleMs` without pointer
 * movement. `allowMoves` lets a deliberate move (a drop onto a section)
 * show for `ms` even while held.
 */
export function useOrderFreeze({ touchHoldMs = 600, idleMs = 400 } = {}) {
  const [held, setHeld] = useState(false);
  const [moving, setMoving] = useState(false);
  const hovering = useRef(false);
  const touching = useRef(false);
  const tail = useRef<Timer | null>(null);
  const idle = useRef<Timer | null>(null);
  const moveTimer = useRef<Timer | null>(null);
  const stopWatchingIdle = useRef<(() => void) | null>(null);

  const clearIdle = useCallback(() => {
    if (idle.current !== null) clearTimeout(idle.current);
    idle.current = null;
    stopWatchingIdle.current?.();
    stopWatchingIdle.current = null;
  }, []);

  const settle = useCallback(() => {
    clearIdle();
    if (hovering.current || touching.current || tail.current !== null) {
      setHeld(true);
      return;
    }
    const restart = () => {
      if (idle.current !== null) clearTimeout(idle.current);
      idle.current = setTimeout(() => {
        clearIdle();
        setHeld(false);
      }, idleMs);
    };
    restart();
    window.addEventListener("pointermove", restart, { passive: true });
    stopWatchingIdle.current = () => window.removeEventListener("pointermove", restart);
  }, [clearIdle, idleMs]);

  const holdAfterTouch = useCallback(() => {
    if (tail.current !== null) clearTimeout(tail.current);
    tail.current = setTimeout(() => {
      tail.current = null;
      settle();
    }, touchHoldMs);
    settle();
  }, [settle, touchHoldMs]);

  const allowMoves = useCallback((ms = 2000) => {
    if (moveTimer.current !== null) clearTimeout(moveTimer.current);
    setMoving(true);
    moveTimer.current = setTimeout(() => {
      moveTimer.current = null;
      setMoving(false);
    }, ms);
  }, []);

  useEffect(() => () => {
    clearIdle();
    if (tail.current !== null) clearTimeout(tail.current);
    if (moveTimer.current !== null) clearTimeout(moveTimer.current);
  }, [clearIdle]);

  const handlers = useMemo(() => ({
    onPointerEnter: (event: { pointerType: string }) => {
      if (event.pointerType === "touch") return;
      hovering.current = true;
      settle();
    },
    // Covers a list that mounted under a resting pointer.
    onPointerMove: (event: { pointerType: string }) => {
      if (event.pointerType === "touch" || hovering.current) return;
      hovering.current = true;
      settle();
    },
    onPointerLeave: (event: { pointerType: string }) => {
      if (event.pointerType === "touch") return;
      hovering.current = false;
      settle();
    },
    onTouchStart: () => {
      touching.current = true;
      settle();
    },
    onTouchEnd: () => {
      touching.current = false;
      holdAfterTouch();
    },
    onTouchCancel: () => {
      touching.current = false;
      holdAfterTouch();
    },
  }), [settle, holdAfterTouch]);

  return { frozen: held && !moving, handlers, onScroll: holdAfterTouch, allowMoves };
}
