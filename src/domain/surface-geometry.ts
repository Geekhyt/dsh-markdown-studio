import { clamp } from './settings';

export interface SurfaceRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PopoverPlacementSpec {
  surface: SurfaceRect;
  width: number;
  height: number;
  preferredLeft: number;
  preferredTop: number;
  pad?: number;
  obstacles?: readonly SurfaceRect[];
}

function isSideOverlay(obs: SurfaceRect, surface: SurfaceRect): boolean {
  return obs.height >= surface.height * 0.7 && obs.left < surface.right && obs.left > surface.left + 120;
}

function rectsIntersect(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  br: number,
  bb: number,
): boolean {
  return !(ax + aw <= bx || ax >= br || ay + ah <= by || ay >= bb);
}

/**
 * Available horizontal width inside `surface` after subtracting any full-height
 * right-side overlay chrome (such as an absolute-positioned SettingsDrawer).
 */
export function computeUnobstructedWidth(surface: SurfaceRect, obstacles: readonly SurfaceRect[] = []): number {
  let avail = surface.width;
  for (const obs of obstacles) {
    if (isSideOverlay(obs, surface)) {
      avail = Math.min(avail, obs.left - surface.left);
    }
  }
  return Math.max(0, avail);
}

function avoidCornerObstacle(
  left: number,
  top: number,
  width: number,
  height: number,
  pad: number,
  maxTop: number,
  obs: SurfaceRect,
  surface: SurfaceRect,
): { left: number; top: number } {
  const bx = obs.left - surface.left;
  const by = obs.top - surface.top;
  const br = obs.right - surface.left;
  const bb = obs.bottom - surface.top;
  if (!rectsIntersect(left, top, width, height, bx, by, br, bb)) return { left, top };
  const belowTop = Math.round(bb + 6);
  if (belowTop <= maxTop) return { left, top: belowTop };
  const shiftLeft = Math.round(bx - width - 8);
  if (shiftLeft >= pad) return { left: shiftLeft, top };
  return { left, top };
}

/**
 * Unified placement solver for editor-scoped floating popovers (`Outline`,
 * `SlashMenu`, `SelectionBubble`). Clamps within the unobstructed surface area
 * and shifts away from corner chrome such as `ImmersiveDock`.
 */
export function computeSafePopoverPos(spec: PopoverPlacementSpec): { top: number; left: number; availWidth: number } {
  const pad = spec.pad ?? 10;
  const obstacles = spec.obstacles || [];
  const availWidth = computeUnobstructedWidth(spec.surface, obstacles);
  const maxLeft = Math.max(pad, Math.round(availWidth - spec.width - pad));
  const maxTop = Math.max(pad, Math.round(spec.surface.height - spec.height - pad));
  let left = clamp(Math.round(spec.preferredLeft), pad, maxLeft);
  let top = clamp(Math.round(spec.preferredTop), pad, maxTop);
  for (const obs of obstacles) {
    if (isSideOverlay(obs, spec.surface)) continue;
    const adjusted = avoidCornerObstacle(left, top, spec.width, spec.height, pad, maxTop, obs, spec.surface);
    left = adjusted.left;
    top = adjusted.top;
  }
  return { top, left, availWidth };
}
