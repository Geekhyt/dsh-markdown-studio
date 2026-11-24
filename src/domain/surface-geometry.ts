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
  maxLeft: number,
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
  const aboveTop = Math.round(by - height - 6);
  if (aboveTop >= pad) return { left, top: aboveTop };
  const shiftLeft = Math.round(bx - width - 8);
  if (shiftLeft >= pad) return { left: shiftLeft, top };
  const shiftRight = Math.round(br + 8);
  if (shiftRight <= maxLeft) return { left: shiftRight, top };
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
    const adjusted = avoidCornerObstacle(left, top, spec.width, spec.height, pad, maxLeft, maxTop, obs, spec.surface);
    left = adjusted.left;
    top = adjusted.top;
  }
  return { top, left, availWidth };
}

export interface CaretPopoverSpec {
  surface: SurfaceRect;
  caretTop: number;
  caretBottom: number;
  caretLeft: number;
  width: number;
  maxMenuHeight: number;
  gap?: number;
  pad?: number;
  obstacles?: readonly SurfaceRect[];
}

/**
 * Caret-anchored popover solver (`SlashMenu`). Bounds `maxHeight` to the free
 * vertical span on the chosen side of the caret so the popup never covers the
 * line being typed or overflows the editor viewport.
 */
export function computeCaretPopoverPos(spec: CaretPopoverSpec): {
  top?: number;
  bottom?: number;
  left: number;
  maxHeight: number;
} {
  const gap = spec.gap ?? 6;
  const pad = spec.pad ?? 10;
  const spaceBelow = Math.floor(spec.surface.bottom - spec.caretBottom - gap - pad);
  const spaceAbove = Math.floor(spec.caretTop - spec.surface.top - gap - pad);
  const preferBelow = spaceBelow >= Math.min(220, spec.maxMenuHeight) || spaceBelow >= spaceAbove;
  const freeSpan = preferBelow ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(72, Math.min(spec.maxMenuHeight, freeSpan));
  const caretTopRel = spec.caretTop - spec.surface.top;
  const preferredTop = preferBelow
    ? Math.round(spec.caretBottom - spec.surface.top + gap)
    : Math.max(pad, Math.round(caretTopRel - gap - maxHeight));
  const placed = computeSafePopoverPos({
    surface: spec.surface,
    width: spec.width,
    height: maxHeight,
    preferredLeft: spec.caretLeft - spec.surface.left,
    preferredTop,
    pad,
    obstacles: spec.obstacles,
  });
  if (!preferBelow) {
    const caretClearBottom = Math.floor(caretTopRel - gap);
    if (placed.top === preferredTop) {
      const bottom = Math.max(pad, Math.round(spec.surface.height - caretClearBottom));
      return { bottom, left: placed.left, maxHeight };
    }
    const clampedAbove = Math.floor(caretClearBottom - placed.top);
    if (clampedAbove >= 72) {
      return { top: placed.top, left: placed.left, maxHeight: Math.min(maxHeight, clampedAbove) };
    }
    if (spaceBelow >= 72) {
      return {
        top: Math.round(spec.caretBottom - spec.surface.top + gap),
        left: placed.left,
        maxHeight: Math.min(spec.maxMenuHeight, spaceBelow),
      };
    }
  }
  const caretBottomRel = spec.caretBottom - spec.surface.top + gap;
  if (preferBelow && placed.top < caretBottomRel && spaceAbove >= 72) {
    const clampedAbove = Math.floor(caretTopRel - gap - placed.top);
    if (clampedAbove >= 72) {
      return { top: placed.top, left: placed.left, maxHeight: Math.min(maxHeight, clampedAbove) };
    }
  }
  return { top: placed.top, left: placed.left, maxHeight };
}
