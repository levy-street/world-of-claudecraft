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

// Clamp a desired geometry to the viewport and size limits. `chromeH` is the
// measured height of the tab strip above the frame, included so the *whole* box
// (strip + frame) stays on-screen.
export function clampChatBox(
  geo: ChatBoxGeometry,
  viewport: { w: number; h: number },
  chromeH: number,
  limits: ChatBoxLimits = CHAT_BOX_LIMITS,
): ChatBoxGeometry {
  const { margin } = limits;
  const width = clamp(geo.width, limits.minWidth, Math.min(limits.maxWidth, viewport.w - margin * 2));
  const height = clamp(
    geo.height,
    limits.minHeight,
    Math.min(limits.maxHeight, viewport.h - margin * 2 - Math.max(0, chromeH)),
  );
  const totalH = height + Math.max(0, chromeH);
  const maxLeft = Math.max(margin, viewport.w - width - margin);
  const maxTop = Math.max(margin, viewport.h - totalH - margin);
  return {
    left: clamp(geo.left, margin, maxLeft),
    top: clamp(geo.top, margin, maxTop),
    width,
    height,
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
