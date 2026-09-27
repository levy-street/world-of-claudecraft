// Pure geometry core for the movable + resizable meter panels (the damage
// window and the detached Threat / Healing windows).
//
// DOM-free and i18n-free: it owns the clamp, the (de)serialization, and the
// visual-to-author-space conversion, so meters_frame.ts stays a thin pointer
// adapter and every rule here is unit-testable in plain Node.
//
// Why its own core rather than the chat box's: `placeChatBox` lives in the chat
// DOMAIN barrel and is shaped by chat-specific concerns (a `chromeH` tab strip
// measured outside the box, and a `reservedAbove` store-promo band). A meter
// panel has neither, and the meters must not take a dependency on the chat
// domain to get a rectangle clamped. The two stay independent on purpose; if a
// third movable panel appears, THAT is the moment to lift one shared core.

import { anchorAxis } from './target_frame_pos';

export interface MeterFrameGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The visual viewport the box was saved under (both or neither), so a
   *  later apply can re-anchor it when the window size changes (fullscreen
   *  exit): see anchorAdjustedMeterFrame. */
  vw?: number;
  vh?: number;
}

export interface MeterFrameLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  /** Keep-out band from every viewport edge. */
  margin: number;
}

// Defaults for a DETACHED window, whose chrome is one title plus three small
// controls: it can go usefully narrow. The grow range is generous either way,
// wide enough for long ability rows and tall enough for a full raid.
export const METER_FRAME_LIMITS: MeterFrameLimits = {
  minWidth: 180,
  maxWidth: 560,
  minHeight: 90,
  maxHeight: 620,
  margin: 8,
};

/**
 * The tabbed window's floor is its stock width, and that is a measurement, not
 * a taste call: its title carries three tabs plus three controls, which wrap
 * onto a second line below ~238px. Letting a shrink break the panel's own
 * chrome is worse than refusing to shrink past where it was designed to sit.
 */
export const TABBED_METER_FRAME_LIMITS: MeterFrameLimits = {
  ...METER_FRAME_LIMITS,
  minWidth: 240,
};

function clamp(value: number, lo: number, hi: number): number {
  // hi can fall below lo on a tiny viewport; prefer the lower bound so the
  // panel never gets a negative size.
  return Math.max(lo, Math.min(hi, value));
}

// A positive, finite divisor for the UI-scale compensation. A bad read (0,
// negative, NaN, Infinity) falls back to 1 so a drag never blanks the panel.
function safeScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/** Clamp a desired VISUAL geometry so the panel stays fully on screen. */
export function clampMeterFrame(
  geo: MeterFrameGeometry,
  viewport: { w: number; h: number },
  limits: MeterFrameLimits = METER_FRAME_LIMITS,
): MeterFrameGeometry {
  const { margin } = limits;
  const width = clamp(
    geo.width,
    limits.minWidth,
    Math.min(limits.maxWidth, viewport.w - margin * 2),
  );
  const height = clamp(
    geo.height,
    limits.minHeight,
    Math.min(limits.maxHeight, viewport.h - margin * 2),
  );
  const maxLeft = Math.max(margin, viewport.w - width - margin);
  const maxTop = Math.max(margin, viewport.h - height - margin);
  return {
    left: clamp(geo.left, margin, maxLeft),
    top: clamp(geo.top, margin, maxTop),
    width,
    height,
  };
}

export interface MeterFramePlacement {
  /** Clamped geometry in VISUAL (screen / pointer) space: persist THIS, so a
   *  panel saved at one UI Scale renders in the same visual spot at another. */
  geo: MeterFrameGeometry;
  /** Author-space values for the style writes. The panels live inside #ui
   *  (`zoom: var(--ui-scale)`), which re-multiplies these back to `geo`. */
  css: MeterFrameGeometry;
}

/**
 * Clamp a desired VISUAL geometry, then derive the AUTHOR-space writes the #ui
 * zoom re-multiplies back. Mirrors the chat box and hud.ts
 * `setWindowPixelPosition`: `getBoundingClientRect()` and pointer clientX/Y are
 * post-zoom, but style left/top/width/height are author lengths.
 */
export function placeMeterFrame(
  geo: MeterFrameGeometry,
  viewport: { w: number; h: number },
  scale: number,
  limits: MeterFrameLimits = METER_FRAME_LIMITS,
): MeterFramePlacement {
  const clamped = clampMeterFrame(geo, viewport, limits);
  const z = safeScale(scale);
  return {
    geo: clamped,
    css: {
      left: clamped.left / z,
      top: clamped.top / z,
      width: clamped.width / z,
      height: clamped.height / z,
    },
  };
}

export function serializeMeterFrame(geo: MeterFrameGeometry): string {
  const out: Record<string, number> = {
    left: geo.left,
    top: geo.top,
    width: geo.width,
    height: geo.height,
  };
  // The viewport the box was saved under, so a later apply can re-anchor it
  // when the window size changes (anchorAdjustedMeterFrame).
  if (geo.vw !== undefined && geo.vh !== undefined) {
    out.vw = Math.round(geo.vw);
    out.vh = Math.round(geo.vh);
  }
  return JSON.stringify(out);
}

/**
 * Parse persisted geometry, returning null for missing or corrupt data so the
 * caller falls back to the CSS default anchor. Every field must be finite;
 * the saved-viewport pair is optional (older payloads), both fields or neither.
 */
export function parseMeterFrame(raw: string | null | undefined): MeterFrameGeometry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nums = ['left', 'top', 'width', 'height'].map((key) => parsed[key]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const [left, top, width, height] = nums as number[];
    const out: MeterFrameGeometry = { left, top, width, height };
    if (
      typeof parsed.vw === 'number' &&
      Number.isFinite(parsed.vw) &&
      parsed.vw > 0 &&
      typeof parsed.vh === 'number' &&
      Number.isFinite(parsed.vh) &&
      parsed.vh > 0
    ) {
      out.vw = parsed.vw;
      out.vh = parsed.vh;
    }
    return out;
  } catch {
    return null;
  }
}

/** Re-anchor a saved panel box to the CURRENT viewport, exactly as
 *  anchorAdjustedPos does for the movable frames and anchorAdjustedChatBox
 *  does for the chat box (the shared anchorAxis rule: each axis keeps its
 *  distance to whichever of start / center / end it sat closest to when
 *  saved). A box saved by an older build carries no viewport and returns
 *  unchanged. */
export function anchorAdjustedMeterFrame(
  geo: MeterFrameGeometry,
  viewport: { w: number; h: number },
): MeterFrameGeometry {
  const { vw, vh } = geo;
  if (vw === undefined || vh === undefined) return geo;
  if (vw === viewport.w && vh === viewport.h) return geo;
  return {
    ...geo,
    left: anchorAxis(geo.left, geo.width, vw, viewport.w),
    top: anchorAxis(geo.top, geo.height, vh, viewport.h),
  };
}

/**
 * Geometry for a panel being detached or first moved: its CURRENT on-screen box
 * becomes the starting geometry, so popping a window out or grabbing its title
 * never makes it jump. `fallback` covers a panel measured while hidden (a zero
 * rect), which is how a detached window opens for the very first time.
 */
export function initialMeterFrame(
  rect: { left: number; top: number; width: number; height: number },
  fallback: MeterFrameGeometry,
): MeterFrameGeometry {
  const usable = rect.width > 0 && rect.height > 0;
  return usable
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : { ...fallback };
}

export type DockSide = 'right' | 'left' | 'bottom' | 'top';

export interface SnapTarget {
  id: string;
  geo: MeterFrameGeometry;
}

export interface SnapResult {
  geo: MeterFrameGeometry;
  dockedTo: { id: string; side: DockSide } | null;
}

export const SNAP_THRESHOLD = 18;

export function oppositeDockSide(side: DockSide): DockSide {
  switch (side) {
    case 'right':
      return 'left';
    case 'left':
      return 'right';
    case 'bottom':
      return 'top';
    case 'top':
      return 'bottom';
  }
}

/**
 * Snap a moving frame geometry to adjacent target geometries within SNAP_THRESHOLD.
 * When snapped side-by-side (right/left), matches top and height.
 * When snapped stacked (bottom/top), matches left and width.
 */
export function snapFrameToTargets(
  moving: MeterFrameGeometry,
  targets: readonly SnapTarget[],
  threshold = SNAP_THRESHOLD,
): SnapResult {
  let bestDist = threshold + 1;
  let bestDock: { id: string; side: DockSide } | null = null;
  let bestGeo: MeterFrameGeometry = { ...moving };

  for (const target of targets) {
    const t = target.geo;

    // Check RIGHT of target (moving left near target right)
    const distRight = Math.abs(moving.left - (t.left + t.width));
    if (distRight < bestDist && Math.abs(moving.top - t.top) < threshold * 2) {
      bestDist = distRight;
      bestDock = { id: target.id, side: 'right' };
      bestGeo = {
        ...moving,
        left: t.left + t.width,
        top: Math.abs(moving.top - t.top) <= threshold ? t.top : moving.top,
        height: Math.abs(moving.top - t.top) <= threshold ? t.height : moving.height,
      };
    }

    // Check LEFT of target (moving right near target left)
    const distLeft = Math.abs(moving.left + moving.width - t.left);
    if (distLeft < bestDist && Math.abs(moving.top - t.top) < threshold * 2) {
      bestDist = distLeft;
      bestDock = { id: target.id, side: 'left' };
      bestGeo = {
        ...moving,
        left: t.left - moving.width,
        top: Math.abs(moving.top - t.top) <= threshold ? t.top : moving.top,
        height: Math.abs(moving.top - t.top) <= threshold ? t.height : moving.height,
      };
    }

    // Check BOTTOM of target (moving top near target bottom)
    const distBottom = Math.abs(moving.top - (t.top + t.height));
    if (distBottom < bestDist && Math.abs(moving.left - t.left) < threshold * 2) {
      bestDist = distBottom;
      bestDock = { id: target.id, side: 'bottom' };
      bestGeo = {
        ...moving,
        top: t.top + t.height,
        left: Math.abs(moving.left - t.left) <= threshold ? t.left : moving.left,
        width: Math.abs(moving.left - t.left) <= threshold ? t.width : moving.width,
      };
    }

    // Check TOP of target (moving bottom near target top)
    const distTop = Math.abs(moving.top + moving.height - t.top);
    if (distTop < bestDist && Math.abs(moving.left - t.left) < threshold * 2) {
      bestDist = distTop;
      bestDock = { id: target.id, side: 'top' };
      bestGeo = {
        ...moving,
        top: t.top - moving.height,
        left: Math.abs(moving.left - t.left) <= threshold ? t.left : moving.left,
        width: Math.abs(moving.left - t.left) <= threshold ? t.width : moving.width,
      };
    }
  }

  return { geo: bestGeo, dockedTo: bestDock };
}

/**
 * When frame A is resized, update docked frame B's geometry to stay attached and match size.
 * - If B is on the right of A: sync height and align top, shift B.left to A.left + A.width.
 * - If B is on the left of A: sync height and align top, shift B.left to A.left - B.width.
 * - If B is on the bottom of A: sync width and align left, shift B.top to A.top + A.height.
 * - If B is on the top of A: sync width and align left, shift B.top to A.top - B.height.
 */
export function syncDockedResize(
  parentGeo: MeterFrameGeometry,
  childGeo: MeterFrameGeometry,
  side: DockSide,
): MeterFrameGeometry {
  if (side === 'right') {
    return {
      ...childGeo,
      left: parentGeo.left + parentGeo.width,
      top: parentGeo.top,
      height: parentGeo.height,
    };
  }
  if (side === 'left') {
    return {
      ...childGeo,
      left: parentGeo.left - childGeo.width,
      top: parentGeo.top,
      height: parentGeo.height,
    };
  }
  if (side === 'bottom') {
    return {
      ...childGeo,
      top: parentGeo.top + parentGeo.height,
      left: parentGeo.left,
      width: parentGeo.width,
    };
  }
  return {
    ...childGeo,
    top: parentGeo.top - childGeo.height,
    left: parentGeo.left,
    width: parentGeo.width,
  };
}
