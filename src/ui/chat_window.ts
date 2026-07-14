// Pure geometry helpers for the movable / resizable chat box. No DOM, no Three,
// no sim deps — just arithmetic and (de)serialization so the clamping rules can
// be unit-tested headlessly. The DOM wiring (pointer events, applying styles)
// lives in hud.ts; this module only answers "given a desired box and a viewport,
// what is the legal box, and how do we round-trip it through localStorage?".

// `left`/`top` are the chat *wrap*'s top-left in viewport px. `width` is the wrap
// width; `height` is the scrollable chat *pane/frame* height (the tab strip sits
// above it and is measured separately as `chromeH` when clamping).
export interface ChatBoxGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ChatBoxLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  margin: number;
}

export type ChatBoxReservedAbove = number | ((width: number) => number);

// Defaults roughly track the stock chat box (~370px wide, 184px pane) while
// allowing a generous grow range. maxWidth/maxHeight are further capped by the
// viewport in clampChatBox so they never need to know the screen size here.
export const CHAT_BOX_LIMITS: ChatBoxLimits = {
  minWidth: 240,
  maxWidth: 760,
  minHeight: 96,
  maxHeight: 600,
  margin: 8,
};

function clamp(v: number, lo: number, hi: number): number {
  // hi can fall below lo on tiny viewports; prefer the lower bound (margin)
  // so the box never gets a negative size.
  return Math.max(lo, Math.min(hi, v));
}

function reservedAboveHeight(reservedAbove: ChatBoxReservedAbove, width: number): number {
  const raw = typeof reservedAbove === 'function' ? reservedAbove(width) : reservedAbove;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

// Clamp a desired geometry to the viewport and size limits. `chromeH` is the
// measured height of the tab strip above the frame. `reservedAbove` accounts
// for optional UI attached above the wrap (for example, the Store promo), so
// the full visible stack remains inside the viewport.
export function clampChatBox(
  geo: ChatBoxGeometry,
  viewport: { w: number; h: number },
  chromeH: number,
  limits: ChatBoxLimits = CHAT_BOX_LIMITS,
  reservedAbove: ChatBoxReservedAbove = 0,
): ChatBoxGeometry {
  const { margin } = limits;
  const width = clamp(
    geo.width,
    limits.minWidth,
    Math.min(limits.maxWidth, viewport.w - margin * 2),
  );
  const aboveH = reservedAboveHeight(reservedAbove, width);
  const height = clamp(
    geo.height,
    limits.minHeight,
    Math.min(limits.maxHeight, viewport.h - margin * 2 - Math.max(0, chromeH) - aboveH),
  );
  const totalH = height + Math.max(0, chromeH);
  const maxLeft = Math.max(margin, viewport.w - width - margin);
  const maxTop = Math.max(margin, viewport.h - totalH - margin);
  const minTop = margin + aboveH;
  return {
    left: clamp(geo.left, margin, maxLeft),
    top: clamp(geo.top, minTop, maxTop),
    width,
    height,
  };
}

// A positive, finite divisor for the UI-scale compensation below. A bad read
// (0, negative, NaN, Infinity) falls back to 1 so a drag never blanks the box.
function safeScale(scale: number): number {
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export interface ChatBoxPlacement {
  /** Clamped geometry in VISUAL (screen / pointer) space: persist THIS so a box
   *  saved at one UI Scale renders at the same visual place at another. */
  geo: ChatBoxGeometry;
  /** Author-space (visual / scale) values for the #chatlog-wrap / #chatlog-frame
   *  style writes: those elements live inside #ui (`zoom: var(--ui-scale)`), which
   *  re-multiplies the author lengths back to `geo` on screen. (#chat-input is a
   *  sibling of #ui, outside the zoom, so its caller writes `geo` directly.) */
  css: ChatBoxGeometry;
}

// Clamp a desired VISUAL geometry to the viewport / limits, then derive the
// AUTHOR-space css writes the #ui zoom re-multiplies back. Mirrors hud.ts
// setWindowPixelPosition: getBoundingClientRect() and pointer clientX/clientY are
// post-zoom, but style left/top/width/height are author lengths, so the writes
// divide by the live UI scale. `scale` of 1 (the default) is a no-op.
export function placeChatBox(
  geo: ChatBoxGeometry,
  viewport: { w: number; h: number },
  chromeH: number,
  scale: number,
  limits: ChatBoxLimits = CHAT_BOX_LIMITS,
  reservedAbove: ChatBoxReservedAbove = 0,
): ChatBoxPlacement {
  const clamped = clampChatBox(geo, viewport, chromeH, limits, reservedAbove);
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

export function serializeChatBox(geo: ChatBoxGeometry): string {
  return JSON.stringify({ left: geo.left, top: geo.top, width: geo.width, height: geo.height });
}

// Parse persisted geometry, returning null for missing/corrupt data so callers
// fall back to the CSS default. Every field must be a finite number.
export function parseChatBox(raw: string | null | undefined): ChatBoxGeometry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const nums = ['left', 'top', 'width', 'height'].map((k) => o[k]);
    if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
    const [left, top, width, height] = nums as number[];
    return { left, top, width, height };
  } catch {
    return null;
  }
}
