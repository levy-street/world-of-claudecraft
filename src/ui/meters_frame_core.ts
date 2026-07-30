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

export interface MeterFrameGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
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
  return JSON.stringify({ left: geo.left, top: geo.top, width: geo.width, height: geo.height });
}

/**
 * Parse persisted geometry, returning null for missing or corrupt data so the
 * caller falls back to the CSS default anchor. Every field must be finite.
 */
export function parseMeterFrame(raw: string | null | undefined): MeterFrameGeometry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nums = ['left', 'top', 'width', 'height'].map((key) => parsed[key]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const [left, top, width, height] = nums as number[];
    return { left, top, width, height };
  } catch {
    return null;
  }
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
