import { useLayoutEffect, useState, type RefObject } from "react";
import type { ExperimentalSidebarNavigationItem } from "@get-bb/plugin-sdk/app";
import { railHostValuesCss } from "./railHostStyles";

const FOOTER_FLOOR = 92;
const MIN_ITEMS = 200;

/**
 * Height the destination list may claim. The host footer (updates, settings)
 * then receives whatever is left, at least two controls, and the list scrolls.
 * A shell we cannot measure keeps the old full reserve.
 */
export function railReserve(
  shell: number,
  itemsHeight: number,
  railFooter: number,
  chrome: number,
  hostContent: number,
  minimumItems = MIN_ITEMS,
): number {
  if (!(shell >= minimumItems + FOOTER_FLOOR)) {
    return Math.ceil(itemsHeight + railFooter + chrome);
  }
  const available = shell - railFooter - chrome - minimumItems;
  const footerRoom = Math.min(
    Math.max(hostContent, FOOTER_FLOOR),
    Math.max(FOOTER_FLOOR, available),
  );
  return Math.ceil(shell - footerRoom - 20);
}

/** Only the optional rail couples to the host shell; effects release on unmount. */
export function useRailHostStructure(railRef: RefObject<HTMLElement | null>) {
  const [hostSupportsWide, setHostSupportsWide] = useState(false);
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const sidebar = rail.closest('[data-sidebar="sidebar"]');
    const panel = sidebar?.parentElement;
    setHostSupportsWide(
      Boolean(
        sidebar &&
          sidebar.querySelector(':scope > [data-sidebar="footer"]') &&
          panel?.parentElement?.classList.contains("peer") &&
          getComputedStyle(panel).getPropertyValue("--sidebar-width").trim() !==
            "",
      ),
    );
  }, []);
  return hostSupportsWide;
}

export function useRailMeasurements(
  railRef: RefObject<HTMLElement | null>,
  /** The rail's own <style> for measured host values (railHostValuesCss). */
  hostValuesRef: RefObject<HTMLStyleElement | null>,
  items: readonly ExperimentalSidebarNavigationItem[],
  tileCount: number,
  wide: boolean,
  minimumItems = MIN_ITEMS,
) {
  // The rail and BB's footer share one column. Publish how much height the
  // rail needs (every destination plus its own footer, unscrolled) so the
  // stylesheet can cap the host footer's stack instead; otherwise a tall
  // footer scrolls the primary destinations out of view on short windows.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const navRoot = rail.parentElement;
    const hostValues = hostValuesRef.current;
    // BB's elements are only read. The reserve and BB's footer thumb are
    // written as rules into the rail's own <style>, scoped to the sidebar:
    // a custom property on the root restyled the whole document each frame.
    const sidebar = rail.closest<HTMLElement>('[data-sidebar="sidebar"]');
    const hostMenu = sidebar?.querySelector<HTMLElement>(
      ':scope > [data-sidebar="footer"] > [data-sidebar="menu"]',
    );
    const items = rail.querySelector<HTMLElement>(".radar-double-rail-items");
    const footer = rail.querySelector<HTMLElement>(".radar-double-rail-footer");
    const hostFooter = hostMenu?.parentElement;
    if (!items || !footer) return;
    /** Where a thumb for `stack` sits within `owner`; null when it fits. */
    const thumbFor = (stack: HTMLElement, owner: HTMLElement) => {
      if (stack.scrollHeight <= stack.clientHeight + 1) return null;
      const height = Math.min(
        stack.clientHeight,
        Math.max(18, stack.clientHeight ** 2 / stack.scrollHeight),
      );
      const progress = Math.min(
        1,
        Math.max(
          0,
          stack.scrollTop / (stack.scrollHeight - stack.clientHeight),
        ),
      );
      const top =
        stack.getBoundingClientRect().top -
        owner.getBoundingClientRect().top +
        progress * (stack.clientHeight - height);
      return { top, height };
    };
    let reserve: number | null = null;
    let footerThumb: { top: number; height: number } | null = null;
    const writeHostValues = () => {
      if (!hostValues) return;
      const css = railHostValuesCss({ reserve, footerThumb, wide });
      if (hostValues.textContent !== css) hostValues.textContent = css;
    };
    const updateScroll = () => {
      const railThumb = thumbFor(items, rail);
      navRoot?.toggleAttribute("data-rail-overflow", railThumb !== null);
      if (railThumb) {
        rail.style.setProperty("--radar-scroll-top", `${railThumb.top}px`);
        rail.style.setProperty("--radar-scroll-height", `${railThumb.height}px`);
      } else {
        rail.style.removeProperty("--radar-scroll-top");
        rail.style.removeProperty("--radar-scroll-height");
      }
      footerThumb = hostMenu && hostFooter ? thumbFor(hostMenu, hostFooter) : null;
      writeHostValues();
    };
    // Scroll fires many times a frame, and each update reads layout. The
    // thumb only needs the latest position, once per frame.
    let scrollFrame: number | null = null;
    const onScroll = () => {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        updateScroll();
      });
    };
    const measure = () => {
      const styles = getComputedStyle(rail);
      const length = (value: string) => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const chrome =
        length(styles.paddingTop) +
        length(styles.paddingBottom) +
        length(styles.rowGap || styles.gap);
      reserve = sidebar
        ? railReserve(sidebar.clientHeight, items.scrollHeight, footer.offsetHeight, chrome, hostMenu?.scrollHeight ?? 0, minimumItems)
        : null;
      updateScroll();
    };
    measure();
    items.addEventListener("scroll", onScroll, { passive: true });
    hostMenu?.addEventListener("scroll", onScroll, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(rail);
    observer?.observe(items);
    observer?.observe(footer);
    if (hostMenu) observer?.observe(hostMenu);
    // Host actions can change inside a capped stack without resizing it.
    const mutations = new MutationObserver(measure);
    if (hostMenu)
      mutations.observe(hostMenu, { childList: true, subtree: true });
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
      items.removeEventListener("scroll", onScroll);
      hostMenu?.removeEventListener("scroll", onScroll);
      if (hostValues) hostValues.textContent = "";
      rail.style.removeProperty("--radar-scroll-top");
      rail.style.removeProperty("--radar-scroll-height");
      navRoot?.removeAttribute("data-rail-overflow");
    };
  }, [railRef, hostValuesRef, wide, items, tileCount, minimumItems]);
}
