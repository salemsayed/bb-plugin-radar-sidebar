export const MENU_MAX_HEIGHT = 360;
const GAP = 6, EDGE = 8;

export type MenuPlacement = { up: boolean; maxHeight: number };

export function menuPlacement({ top, bottom, viewport, height }: { top: number; bottom: number; viewport: number; height: number }): MenuPlacement {
  const wanted = Math.min(height, MENU_MAX_HEIGHT);
  const below = viewport - bottom - GAP - EDGE, above = top - GAP - EDGE;
  const up = below < wanted && above > below;
  return { up, maxHeight: Math.max(120, Math.min(MENU_MAX_HEIGHT, up ? above : below)) };
}
